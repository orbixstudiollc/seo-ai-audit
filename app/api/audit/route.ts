import { z } from "zod";
import {
  DET_SIGNAL_IDS,
  DET_SIGNALS,
  runAudit,
  type DetSignalId,
  type DetSignalResult,
  type ParsedDocument,
} from "@aeo/scoring";
import { extractArticle, fetchArticle, ImportError } from "@/lib/import";
import { capAuditContent } from "@/lib/audit/contentCap";
import { extractQaPairs, generateRewrites } from "@/lib/audit/generator";
import { mapImportError, mapLlmError } from "@/lib/audit/errors";
import { buildServerModel } from "@/lib/audit/provider";
import { checkRateLimit } from "@/lib/audit/ratelimit";
import { parseAuditUrl } from "@/lib/audit/requestValidation";
import { formatAuditEvent, HEARTBEAT_FRAME } from "@/lib/audit/stream";
import type { AuditFindings, AuditStreamEvent } from "@/lib/audit/types";

/**
 * POST /api/audit — anonymous, stateless (docs/DATA-CONTRACT.md v1.0).
 * SSRF-guarded fetch -> Readability extraction -> @aeo/scoring -> two server-key
 * LLM calls -> SSE stream. No auth, no DB, nothing persisted; the client holds
 * the whole report once the stream completes.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

// Anonymous + no auth means the per-IP bucket is the ONLY abuse control, so
// it's deliberately tight (an audit spends the server's own ANTHROPIC_API_KEY).
const AUDIT_IP_LIMIT_PER_MINUTE = 5;
const AUDIT_IP_WINDOW_MINUTE_SEC = 60;
const AUDIT_IP_LIMIT_PER_DAY = 20;
const AUDIT_IP_WINDOW_DAY_SEC = 24 * 60 * 60;

// lib/import's own default is 10s; the spec caps this route at 15s.
const FETCH_TIMEOUT_MS = 15_000;

// Comment frames every 15s keep idle-timeout proxies/LBs from killing the quiet
// gap between phases (mirrors the pre-pivot route's heartbeat).
const HEARTBEAT_MS = 15_000;

const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

const bodySchema = z.object({ url: z.string() });

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function jsonError(status: number, body: unknown, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(extraHeaders ?? {}) },
  });
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function computeDetSignals(doc: ParsedDocument): Record<DetSignalId, DetSignalResult> {
  return Object.fromEntries(
    DET_SIGNAL_IDS.map((id) => [id, DET_SIGNALS[id](doc)]),
  ) as Record<DetSignalId, DetSignalResult>;
}

type StreamError = Extract<AuditStreamEvent, { type: "error" }>;

function toImportStreamError(err: unknown): StreamError {
  if (err instanceof ImportError) {
    const mapped = mapImportError(err);
    return { type: "error", kind: mapped.kind, message: mapped.message };
  }
  return {
    type: "error",
    kind: "server",
    message: "Something went wrong reading this page. Try again.",
  };
}

function toLlmStreamError(err: unknown): StreamError {
  const mapped = mapLlmError(err);
  return {
    type: "error",
    kind: mapped.kind,
    message: mapped.userMessage,
    ...(mapped.retryAfterSec !== undefined ? { retryAfter: mapped.retryAfterSec } : {}),
  };
}

/** Log-safe failure record: domain + error kind only — never the URL, page content, or raw error. */
function logFailure(stage: string, host: string, kind: string): void {
  console.error(`[audit] ${stage} failed`, { host, kind });
}

type SseWrite = (event: AuditStreamEvent) => void;

/**
 * Hand-rolled SSE, mirroring the pre-pivot route's framing exactly (same
 * heartbeat + close-once discipline) minus the after()-based durable
 * persistence — v1 has nothing to persist. `run` gets a `write(event)` and an
 * `AbortSignal` that fires on client disconnect; a disconnect stops further
 * writes immediately and lets in-flight work observe the signal on its next
 * checkpoint (see the two `signal.aborted` guards in POST below).
 *
 * ponytail: the signal aborts lib/import's fetch and the call-2 rewrite
 * generator (both owned here), but NOT packages/scoring's runAudit — that
 * engine is frozen and its internal generateObject call takes no abortSignal.
 * A disconnect mid-call-1 lets that one LLM call finish before the guard
 * below stops the pipeline; upgrade path is threading abortSignal through
 * RunAuditInput if that engine is ever un-frozen.
 */
function sseResponse(run: (write: SseWrite, signal: AbortSignal) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const abortController = new AbortController();

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

      void run(write, abortController.signal).finally(() => {
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
      abortController.abort();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

// -----------------------------------------------------------------------------
// POST /api/audit
// -----------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  // 1. Per-IP rate limit — the only abuse control available with no auth.
  const ip = clientIp(req);
  const minuteLimit = checkRateLimit(
    `audit:ip:min:${ip}`,
    AUDIT_IP_LIMIT_PER_MINUTE,
    AUDIT_IP_WINDOW_MINUTE_SEC,
  );
  const dayLimit = checkRateLimit(`audit:ip:day:${ip}`, AUDIT_IP_LIMIT_PER_DAY, AUDIT_IP_WINDOW_DAY_SEC);
  const limited = !minuteLimit.allowed ? minuteLimit : !dayLimit.allowed ? dayLimit : null;
  if (limited) {
    return jsonError(
      429,
      { error: "rate_limit", retryAfter: limited.retryAfterSec },
      { "Retry-After": String(limited.retryAfterSec) },
    );
  }

  // 2. Parse + validate the body. Any failure here 400s BEFORE the stream opens.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError(400, { error: "invalid_url", message: "Request body must be JSON." });
  }
  const parsedBody = bodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return jsonError(400, { error: "invalid_url", message: "Request body must include a url." });
  }
  const submittedUrl = parsedBody.data.url;
  const targetUrl = parseAuditUrl(submittedUrl);
  if (!targetUrl) {
    return jsonError(400, {
      error: "invalid_url",
      message: "That doesn't look like a valid http(s) URL.",
    });
  }

  // 3. Stream: fetch -> extract -> DET signals -> rubric call -> rewrite call.
  return sseResponse(async (write, signal) => {
    let fetched: Awaited<ReturnType<typeof fetchArticle>>;
    try {
      fetched = await fetchArticle(targetUrl.toString(), { timeoutMs: FETCH_TIMEOUT_MS, signal });
    } catch (err) {
      if (err instanceof ImportError) logFailure("fetch", targetUrl.hostname, err.kind);
      write(toImportStreamError(err));
      return;
    }

    let article: ReturnType<typeof extractArticle>;
    try {
      article = extractArticle(fetched.html, fetched.finalUrl);
    } catch (err) {
      if (err instanceof ImportError) logFailure("extract", targetUrl.hostname, err.kind);
      write(toImportStreamError(err));
      return;
    }

    if (signal.aborted) return; // client is gone — skip the LLM spend entirely.

    write({
      type: "meta",
      page: {
        url: submittedUrl,
        finalUrl: fetched.finalUrl,
        title: article.title || fetched.title,
        wordCount: article.wordCount,
        fetchedAt: new Date().toISOString(),
      },
    });

    const capped = capAuditContent(article.contentHtml);
    write({ type: "signals", signals: computeDetSignals(capped.doc) });

    let auditResult: Awaited<ReturnType<typeof runAudit>>;
    try {
      auditResult = await runAudit({
        content: capped.content,
        isHtml: capped.isHtml,
        model: buildServerModel("cheap"),
      });
    } catch (err) {
      logFailure("rubric-call", targetUrl.hostname, mapLlmError(err).kind);
      write(toLlmStreamError(err));
      return;
    }

    if (signal.aborted) return;

    const { yields, ...scoreBreakdown } = auditResult;
    const findings: AuditFindings = {
      questionGaps: yields.questionGaps,
      anchorSuggestions: yields.anchorSuggestions,
      blockers: yields.blockers,
      qaPairs: extractQaPairs(capped.doc),
      quotables: [],
    };
    write({ type: "scores", scores: scoreBreakdown, findings });

    try {
      const rewrites = await generateRewrites({
        doc: capped.doc,
        scoreBreakdown,
        model: buildServerModel("strong"),
        abortSignal: signal,
      });
      write({ type: "rewrites", rewrites });
      write({ type: "done" });
    } catch (err) {
      logFailure("rewrite-call", targetUrl.hostname, mapLlmError(err).kind);
      write(toLlmStreamError(err));
    }
  });
}
