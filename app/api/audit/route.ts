import { after } from "next/server";
import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import {
  canonicalize,
  computeParsedDocument,
  DET_SIGNALS,
  DET_SIGNAL_IDS,
  runAudit,
  RUBRIC_VERSION,
  SIGNALS_VERSION,
} from "@aeo/scoring";
import type { DetSignalId, DetSignalResult, RubricYields, ScoreBreakdown } from "@aeo/scoring";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { apiKeys, audits, documents } from "@/db/schema";
import { decryptApiKey } from "@/lib/crypto/apiKeys";
import {
  buildByokModel,
  modelIdFor,
  type CustomProviderConfig,
  type Provider,
} from "@/lib/audit/provider";
import { mapProviderError, type AuditError } from "@/lib/audit/errors";
import { checkRateLimit } from "@/lib/audit/ratelimit";
import { formatAuditEvent, HEARTBEAT_FRAME } from "@/lib/audit/stream";
import { extractQaPairs, generateRewrites } from "@/lib/audit/generator";
import type {
  AuditErrorKind as StreamErrorKind,
  AuditFindings,
  AuditRewrites,
  AuditStreamEvent,
} from "@/lib/audit/types";

// The audit route runs two BYOK LLM calls (~35-80s), so it needs the Node
// runtime and the extended function duration. Vercel's 300s ceiling is now the
// platform default (synthesis #13).
export const runtime = "nodejs";
export const maxDuration = 300;

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

// Audits spend the user's own money, so the per-user bucket is deliberately
// tight; the per-IP bucket blunts shared-host abuse (synthesis #5).
const AUDIT_USER_LIMIT = 10;
const AUDIT_USER_WINDOW_SEC = 60;
const AUDIT_IP_LIMIT = 30;
const AUDIT_IP_WINDOW_SEC = 60;

// Comment frames every 15s keep idle-timeout proxies/LBs from killing the quiet
// gap before the first LLM phase arrives (synthesis #9).
const HEARTBEAT_MS = 15_000;

const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

// Only the document id (and an optional provider preference) crosses the wire.
// The content the audit scores is ALWAYS the persisted document read from the
// DB — never client-sent — so an audit can't score content that differs from
// the row it's attached to, and content_hash stays trustworthy.
const bodySchema = z.object({
  documentId: z.string().min(1),
  provider: z.enum(["openai", "anthropic", "custom"]).optional(),
});

// errors.ts owns the single provider-error mapper; this table only projects its
// richer kind set onto the narrower stream-error union the client consumes.
const STREAM_ERROR_KIND: Record<AuditError["kind"], StreamErrorKind> = {
  rate_limit: "rate_limit",
  auth: "auth",
  quota: "quota",
  invalid_request: "server",
  server: "server",
  unknown: "server",
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Postgres unique_violation (23505), possibly wrapped (e.g. DrizzleQueryError.cause). */
function isUniqueViolation(err: unknown): boolean {
  for (
    let e = err, depth = 0;
    typeof e === "object" && e !== null && depth < 5;
    e = (e as { cause?: unknown }).cause, depth++
  ) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

function jsonError(
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  });
}

/** Map an unknown provider/SDK error to the client stream-error event via the single mapper. */
function toStreamError(err: unknown, provider: Provider): Extract<AuditStreamEvent, { type: "error" }> {
  const mapped = mapProviderError(err, provider);
  return {
    type: "error",
    kind: STREAM_ERROR_KIND[mapped.kind],
    message: mapped.userMessage,
    ...(mapped.retryAfterSec !== undefined ? { retryAfter: mapped.retryAfterSec } : {}),
  };
}

/** Content-only hash (audits.content_hash). Canonicalized with the engine's own
 * normalization so a smart-quote / CRLF / Google-Docs paste of the same article
 * hits the cache instead of re-spending on the LLM (synthesis #14). Together
 * with rubric_version + model_id it reconstitutes the plan's cache key. */
function contentHashOf(content: string): string {
  return createHash("sha256").update(canonicalize(content)).digest("hex");
}

function computeDetSignals(
  doc: ReturnType<typeof computeParsedDocument>,
): Record<DetSignalId, DetSignalResult> {
  return Object.fromEntries(
    DET_SIGNAL_IDS.map((id) => [id, DET_SIGNALS[id](doc)]),
  ) as Record<DetSignalId, DetSignalResult>;
}

/** App-layer findings: the rubric call's yields (question gaps, anchor
 * suggestions, AI Overview blockers) merged with the deterministically
 * extracted qaPairs that feed the findings drawer and the client-templated FAQ
 * JSON-LD. Without `yields` (the cache-hit fallback for legacy rows persisted
 * before yields existed) the LLM-derived lists are empty. quotables stay empty:
 * the v1 rubric has no quotable yield — liftable sentences arrive as call-2
 * quotable REWRITES, not call-1 findings. */
function computeFindings(
  doc: ReturnType<typeof computeParsedDocument>,
  yields?: RubricYields,
): AuditFindings {
  return {
    questionGaps: yields?.questionGaps ?? [],
    anchorSuggestions: yields?.anchorSuggestions ?? [],
    blockers: yields?.blockers ?? [],
    qaPairs: extractQaPairs(doc),
    quotables: [],
  };
}

type SseWrite = (event: AuditStreamEvent) => void;

/**
 * Hand-rolled SSE. `run` receives a `write(event)` and returns when done; this
 * wrapper owns the heartbeat interval and closing the stream exactly once. Every
 * frame is serialized through the shared `formatAuditEvent` so the wire format
 * can never drift from what `useAuditStream` parses. If the client disconnects,
 * `cancel()` stops the heartbeat and every later `write` becomes a no-op — the
 * durable work lives in `after()`, not here.
 */
function sseResponse(run: (write: SseWrite) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write: SseWrite = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(formatAuditEvent(event)));
        } catch {
          closed = true;
        }
      };

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(HEARTBEAT_FRAME));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      void run(write).finally(() => {
        if (heartbeat) clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed or cancelled — nothing to do.
          }
        }
      });
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

type AuditUpdate = Partial<typeof audits.$inferInsert>;

/** Best-effort audit-row write: `after()` persistence must never reject on a
 * transient DB error (an unhandled rejection there is unobservable and would
 * strand the row). Returns false instead of throwing. */
async function tryUpdateAudit(auditId: string, set: AuditUpdate): Promise<boolean> {
  try {
    await db.update(audits).set(set).where(eq(audits.id, auditId));
    return true;
  } catch {
    return false;
  }
}

/**
 * The durable pipeline: runs inside `after()` so the LLM calls and their DB
 * persistence COMPLETE even if the client disconnects mid-stream (synthesis
 * #2). It shares `scoresP`/`rewritesP` with the live SSE mirror, so the work
 * runs exactly once. Never throws — every failure is mapped and persisted
 * best-effort via `tryUpdateAudit`.
 */
async function persistAudit(params: {
  auditId: string;
  provider: Provider;
  findingsP: Promise<AuditFindings>;
  scoresP: Promise<ScoreBreakdown>;
  rewritesP: Promise<AuditRewrites>;
}): Promise<void> {
  const { auditId, provider, findingsP, scoresP, rewritesP } = params;

  let scores: ScoreBreakdown;
  try {
    scores = await scoresP;
  } catch (err) {
    const mapped = mapProviderError(err, provider);
    await tryUpdateAudit(auditId, {
      status: "failed",
      scoresStatus: "failed",
      error: mapped.userMessage,
      completedAt: new Date(),
    });
    return;
  }

  // Derived from the same settled call-1 promise as `scores` — cannot reject here.
  const findings = await findingsP;
  await tryUpdateAudit(auditId, { scores, findings, scoresStatus: "done" });

  let completion: AuditUpdate;
  try {
    const rewrites = await rewritesP;
    completion = { rewrites, rewritesStatus: "done", status: "completed", completedAt: new Date() };
  } catch (err) {
    // synthesis #11: a call-2 failure must NOT discard call-1's paid-for scores.
    // Scores stay persisted and usable, so the audit is 'completed' (partial)
    // with rewrites_status=failed carrying the reason.
    const mapped = mapProviderError(err, provider);
    completion = {
      rewritesStatus: "failed",
      status: "completed",
      error: mapped.userMessage,
      completedAt: new Date(),
    };
  }

  if (!(await tryUpdateAudit(auditId, completion))) {
    // The completed partial-unique index admits one winner per cache key: if a
    // concurrent racer (e.g. a fresh audit started after this row went stale)
    // completed first, this UPDATE conflicts. The loser marks itself failed —
    // best-effort, never throws — and the winner's row serves the cache.
    await tryUpdateAudit(auditId, {
      status: "failed",
      error: "A concurrent audit for the same content completed first.",
      completedAt: new Date(),
    });
  }
}

// -----------------------------------------------------------------------------
// POST /api/audit
// -----------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  // 1. Authenticate.
  const authResult = await auth.api.getSession({ headers: req.headers });
  if (!authResult) {
    return jsonError(401, { error: { kind: "auth", message: "Sign in to run an audit." } });
  }
  const userId = authResult.user.id;

  // 2. Rate-limit (per-user AND per-IP).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const userLimit = checkRateLimit(`audit:user:${userId}`, AUDIT_USER_LIMIT, AUDIT_USER_WINDOW_SEC);
  const ipLimit = checkRateLimit(`audit:ip:${ip}`, AUDIT_IP_LIMIT, AUDIT_IP_WINDOW_SEC);
  const limited = !userLimit.allowed ? userLimit : !ipLimit.allowed ? ipLimit : null;
  if (limited) {
    return jsonError(
      429,
      {
        error: {
          kind: "rate_limit",
          message: `Too many audits. Retry in ${limited.retryAfterSec}s.`,
          retryAfterSec: limited.retryAfterSec,
        },
      },
      { "Retry-After": String(limited.retryAfterSec) },
    );
  }

  // 3. Parse + validate the body.
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return jsonError(400, {
      error: { kind: "invalid_request", message: "Invalid audit request body." },
    });
  }
  const { documentId, provider: preferredProvider } = body;

  // 4. Load + authorize the document. The audit scores the PERSISTED content, so
  //    it comes from here, never the request body. isHtml follows the source.
  const docRows = await db
    .select({ rawContent: documents.rawContent, source: documents.source })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  if (docRows.length === 0) {
    return jsonError(404, {
      error: { kind: "invalid_request", message: "Document not found." },
    });
  }
  const content = docRows[0].rawContent;
  const isHtml = docRows[0].source === "url";

  // 5. Resolve the BYOK provider from the user's stored keys. The client's
  //    localStorage preference is honored when it maps to an existing key;
  //    otherwise fall back to a valid key, then any key. No keys → no_key.
  const keyRows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId));
  if (keyRows.length === 0) {
    return jsonError(401, {
      error: {
        kind: "no_key",
        message: "Add an OpenAI or Anthropic API key in Settings to run an audit.",
      },
    });
  }
  const keyRow =
    keyRows.find((r) => r.provider === preferredProvider) ??
    keyRows.find((r) => r.status === "valid") ??
    keyRows[0];
  const provider = keyRow.provider;
  // Only meaningful (and only ever set on the row) when provider === "custom" —
  // modelIdFor/buildByokModel both ignore it for the two named providers.
  const custom: CustomProviderConfig | undefined =
    provider === "custom" &&
    keyRow.baseUrl &&
    keyRow.apiFormat &&
    keyRow.cheapModel &&
    keyRow.strongModel
      ? {
          baseUrl: keyRow.baseUrl,
          apiFormat: keyRow.apiFormat,
          cheapModel: keyRow.cheapModel,
          strongModel: keyRow.strongModel,
        }
      : undefined;
  if (provider === "custom" && !custom) {
    // Matches the sibling stored-key-integrity 500 below ("server", not an
    // invented kind) so the client's existing AuditErrorKind allowlist covers
    // it without narrowing to a generic/unknown state.
    return jsonError(500, {
      error: { kind: "server", message: "Custom provider is missing its configuration. Re-add it in Settings." },
    });
  }

  // 6. Idempotency. model_id = the cheap tier, which produces the cached scores
  //    (call 1). content_hash + rubric_version + model_id is the cache key.
  const modelId = modelIdFor(provider, "cheap", custom);
  const contentHash = contentHashOf(content);
  const cacheKeyWhere = and(
    eq(audits.userId, userId),
    eq(audits.contentHash, contentHash),
    eq(audits.rubricVersion, RUBRIC_VERSION),
    eq(audits.modelId, modelId),
  );

  // Parse once — used by the cache-hit mirror and the fresh pipeline alike.
  const doc = computeParsedDocument(content, isHtml);
  const detSignals = computeDetSignals(doc);
  // Yield-less fallback for cached rows persisted before findings existed.
  const fallbackFindings = computeFindings(doc);

  // 6a. Completed row for this exact key -> cache hit, ZERO LLM calls (no key
  //     decryption needed to re-serve a cached result).
  const completedRows = await db
    .select()
    .from(audits)
    .where(and(cacheKeyWhere, eq(audits.status, "completed")))
    .limit(1);
  if (completedRows.length > 0) {
    const cached = completedRows[0];
    const cachedFindings = (cached.findings as AuditFindings | null) ?? fallbackFindings;
    return sseResponse(async (write) => {
      write({ type: "signals", signals: detSignals });
      write({ type: "scores", scores: cached.scores as ScoreBreakdown, findings: cachedFindings });
      if (cached.rewrites !== null) {
        write({ type: "rewrites", rewrites: cached.rewrites as AuditRewrites });
      }
      write({ type: "done", auditId: cached.id });
    });
  }

  // 6b. Sweep orphaned running rows: a running row older than maxDuration can
  //     never complete (its owning function is dead — crash, deploy, platform
  //     timeout), so mark it failed instead of letting it block re-runs forever.
  await db
    .update(audits)
    .set({
      status: "failed",
      error: "Audit timed out before completing.",
      completedAt: new Date(),
    })
    .where(
      and(
        cacheKeyWhere,
        eq(audits.status, "running"),
        lt(audits.createdAt, new Date(Date.now() - maxDuration * 1000)),
      ),
    );

  // 7. Decrypt the chosen key. Plaintext stays a request-scoped local only.
  let apiKey: string;
  try {
    apiKey = decryptApiKey(keyRow.ciphertext, userId);
  } catch {
    // Tampered/corrupt ciphertext or misconfigured ENCRYPTION_KEY. Never log raw.
    return jsonError(500, {
      error: { kind: "server", message: "Stored key could not be read. Re-add it in Settings." },
    });
  }

  // 8. Insert the running audit row (status/scores_status/rewrites_status
  //    default). Insert-FIRST: the partial unique index on running rows makes
  //    the duplicate-start guard atomic — of two truly simultaneous POSTs for
  //    the same cache key, exactly one insert succeeds and the loser's unique
  //    violation IS the 409 already_running path (no check-then-insert race,
  //    no double-spend of the user's key).
  let auditId: string;
  try {
    const inserted = await db
      .insert(audits)
      .values({
        documentId,
        userId,
        contentHash,
        rubricVersion: RUBRIC_VERSION,
        signalsVersion: SIGNALS_VERSION,
        modelId,
      })
      .returning({ id: audits.id });
    auditId = inserted[0].id;
  } catch (err) {
    if (isUniqueViolation(err)) {
      return jsonError(409, {
        error: {
          kind: "already_running",
          message: "An audit for this exact content is already running. Watch that one instead.",
        },
      });
    }
    throw err;
  }

  // 9. Start both BYOK LLM calls ONCE. The SSE mirror and the durable after()
  //    persistence share these promises, so the work runs a single time.
  const cheapModel = buildByokModel(provider, apiKey, "cheap", custom);
  const strongModel = buildByokModel(provider, apiKey, "strong", custom);
  const auditP = runAudit({ content, isHtml, model: cheapModel });
  // Split call 1's result at the domain boundary: `scores` stays the pure
  // versioned ScoreBreakdown (persisted/streamed as-is), while the rubric's
  // yields become the LLM-derived findings.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- rest-omit strips `yields` from the persisted breakdown
  const scoresP = auditP.then(({ yields: _yields, ...breakdown }) => breakdown);
  const findingsP = auditP.then((result) => computeFindings(doc, result.yields));
  const rewritesP = scoresP.then((scores) =>
    generateRewrites({ doc, scoreBreakdown: scores, model: strongModel }),
  );
  // Insurance against an unhandledRejection in the microtask window before both
  // real awaiters (persistAudit + the stream) attach.
  auditP.catch(() => {});
  scoresP.catch(() => {});
  findingsP.catch(() => {});
  rewritesP.catch(() => {});

  // 10. Durable completion — completes + persists regardless of the client.
  after(persistAudit({ auditId, provider, findingsP, scoresP, rewritesP }));

  // 11. Best-effort live mirror.
  return sseResponse(async (write) => {
    write({ type: "signals", signals: detSignals });

    let scores: ScoreBreakdown;
    try {
      scores = await scoresP;
    } catch (err) {
      write(toStreamError(err, provider));
      return;
    }
    // findingsP settles with auditP, which already resolved for scoresP to exist.
    write({ type: "scores", scores, findings: await findingsP });

    try {
      const rewrites = await rewritesP;
      write({ type: "rewrites", rewrites });
      write({ type: "done", auditId });
    } catch (err) {
      // Scores already streamed + persisted; surface the rewrite failure only.
      write(toStreamError(err, provider));
    }
  });
}
