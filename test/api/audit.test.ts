import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

// --- Hoisted mutable test state (referenced by the hoisted vi.mock factories) --
const H = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  buildModel: null as
    | ((provider: string, apiKey: string, tier: "cheap" | "strong") => unknown)
    | null,
  afterTasks: [] as Promise<unknown>[],
}));

// The route authenticates via Better Auth; return whatever session the test set.
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => H.session } },
}));

// Swap the Neon client for the in-process PGlite-backed Drizzle instance.
vi.mock("@/db/client", async () => {
  const { dbProxy } = await import("../helpers/testDb");
  return { db: dbProxy };
});

// `after()` needs a Next request scope that does not exist under vitest; capture
// the durable persistence promise so the test can await it explicitly instead.
vi.mock("next/server", () => ({
  after: (task: unknown) => {
    H.afterTasks.push(Promise.resolve(task));
  },
}));

// getAuditStatus (the recovery read) resolves the session from next/headers.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// Real modelIdFor / cost math; only the BYOK model factory is swapped for the
// zero-network mock so no real provider is ever contacted.
vi.mock("@/lib/audit/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit/provider")>();
  return {
    ...actual,
    buildByokModel: (provider: string, apiKey: string, tier: "cheap" | "strong") => {
      if (!H.buildModel) throw new Error("test did not install a mock model builder");
      return H.buildModel(provider, apiKey, tier);
    },
  };
});

import { createHash } from "node:crypto";
import { POST } from "@/app/api/audit/route";
import { getAuditStatus } from "@/app/actions/audit";
import { apiKeys, audits } from "@/db/schema";
import { encryptApiKey, keyHint } from "@/lib/crypto/apiKeys";
import { modelIdFor } from "@/lib/audit/provider";
import { canonicalize, RUBRIC_VERSION } from "@aeo/scoring";
import {
  closeTestDb,
  dbProxy,
  initTestDb,
  resetTestDb,
  seedDocument,
  seedUser,
} from "../helpers/testDb";
import {
  deferred,
  rewriteResponse,
  rubricResponse,
  scriptModel,
  type ScriptedModel,
} from "../helpers/mockModel";
import { collectSse, eventTypes } from "../helpers/sse";

const ARTICLE = `# What is a heat pump?

This is the current opening paragraph that the intro rewrite will target.

## How does a heat pump work in winter?

It extracts ambient heat from outdoor air, even at -15C, and concentrates it.

## What does a heat pump cost?

A typical install runs $4,000 to $8,000, and rebates cover up to $2,000.
`;

let ipSeq = 0;
function auditRequest(documentId: string, provider = "openai"): Request {
  return new Request("http://localhost/api/audit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Distinct IP per request keeps the per-IP rate-limit bucket from bleeding
      // across independent tests (the per-user bucket is already isolated by the
      // fresh user id each test seeds).
      "x-forwarded-for": `10.0.0.${++ipSeq}`,
    },
    body: JSON.stringify({ documentId, provider }),
  });
}

async function seedOpenAiKey(userId: string): Promise<void> {
  const plaintext = "sk-fake-openai-testkey-0000";
  await dbProxy.insert(apiKeys).values({
    userId,
    provider: "openai",
    ciphertext: encryptApiKey(plaintext, userId),
    keyHint: keyHint(plaintext),
    status: "valid",
  });
}

async function flushAfter(): Promise<void> {
  const tasks = H.afterTasks.splice(0);
  await Promise.allSettled(tasks);
}

/** Install cheap+strong mock models for one audit and return them for call-count assertions. */
function installModels(cheap: ScriptedModel, strong: ScriptedModel): void {
  H.buildModel = (_provider, _apiKey, tier) => (tier === "cheap" ? cheap.model : strong.model);
}

async function auditRowFor(userId: string) {
  const rows = await dbProxy.select().from(audits).where(eq(audits.userId, userId));
  return rows;
}

beforeAll(async () => {
  await initTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  H.session = null;
  H.buildModel = null;
  H.afterTasks = [];
});

describe("POST /api/audit — happy path", () => {
  it("streams signals -> scores -> rewrites -> done and persists a completed audit", async () => {
    // Arrange
    const userId = await seedUser();
    await seedOpenAiKey(userId);
    const documentId = await seedDocument(userId, { rawContent: ARTICLE, wordCount: 60 });
    H.session = { user: { id: userId } };
    const cheap = scriptModel(rubricResponse(70), { modelId: "mock-cheap" });
    const strong = scriptModel(
      rewriteResponse("This is the current opening paragraph that the intro rewrite will target."),
      { modelId: "mock-strong" },
    );
    installModels(cheap, strong);

    // Act
    const res = await POST(auditRequest(documentId));
    const events = await collectSse(res);
    await flushAfter();

    // Assert — stream phase order
    expect(res.status).toBe(200);
    // Anti-buffering SSE headers: any proxy/CDN buffering breaks live progress.
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
    expect(eventTypes(events)).toEqual(["signals", "scores", "rewrites", "done"]);
    // Exactly one call to each half of the pipeline.
    expect(cheap.callCount()).toBe(1);
    expect(strong.callCount()).toBe(1);

    // Assert — persisted row
    const rows = await auditRowFor(userId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.status).toBe("completed");
    expect(row.scoresStatus).toBe("done");
    expect(row.rewritesStatus).toBe("done");
    expect(row.scores).not.toBeNull();
    expect(row.rewrites).not.toBeNull();
    expect(row.completedAt).not.toBeNull();
  });

  it("emits a keepalive heartbeat frame during the quiet gap before the first LLM phase", async () => {
    // Only fake the interval clock — everything else (PGlite, crypto, promises)
    // must keep running on real timers.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const userId = await seedUser();
      await seedOpenAiKey(userId);
      const documentId = await seedDocument(userId, { rawContent: ARTICLE, wordCount: 60 });
      H.session = { user: { id: userId } };
      const gate = deferred();
      installModels(
        scriptModel(rubricResponse(70), { modelId: "mock-cheap", gate: gate.promise }),
        scriptModel(rewriteResponse(), { modelId: "mock-strong" }),
      );

      const res = await POST(auditRequest(documentId));
      const body = res.body;
      if (!body) throw new Error("SSE response has no body");
      const reader = body.getReader();
      const decoder = new TextDecoder();

      // The deterministic signals frame is enqueued immediately; the model is
      // gated after it, so the stream then goes quiet.
      const first = decoder.decode((await reader.read()).value);
      expect(first).toContain('"type":"signals"');

      // 15s of silence -> the heartbeat comment frame must arrive BEFORE any
      // further data event (this is what keeps idle proxies from buffering/killing).
      await vi.advanceTimersByTimeAsync(15_000);
      const second = decoder.decode((await reader.read()).value);
      expect(second).toContain(": keepalive");
      expect(second).not.toContain("data:");

      // Release the model and drain to completion so nothing dangles.
      gate.resolve();
      let rest = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        rest += decoder.decode(value, { stream: true });
      }
      expect(rest).toContain('"type":"done"');
      await flushAfter();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("POST /api/audit — idempotency (true concurrent race)", () => {
  it("lets exactly one of two simultaneous POSTs insert + spend; the loser gets 409", async () => {
    // Arrange — hold call 1 open so the winner stays 'running' while both race.
    const userId = await seedUser();
    await seedOpenAiKey(userId);
    const documentId = await seedDocument(userId, { rawContent: ARTICLE, wordCount: 60 });
    H.session = { user: { id: userId } };
    const gate = deferred();
    const cheap = scriptModel(rubricResponse(70), { modelId: "mock-cheap", gate: gate.promise });
    const strong = scriptModel(rewriteResponse(), { modelId: "mock-strong" });
    installModels(cheap, strong);

    // Act — fire BOTH POSTs at once; neither has returned when the other starts,
    // so a check-then-insert guard would let both through. The partial unique
    // index on running rows must arbitrate atomically.
    const [resA, resB] = await Promise.all([
      POST(auditRequest(documentId)),
      POST(auditRequest(documentId)),
    ]);

    // Assert — exactly one winner (200 SSE) and one loser (409 already_running).
    expect([resA.status, resB.status].sort()).toEqual([200, 409]);
    const winner = resA.status === 200 ? resA : resB;
    const loser = resA.status === 200 ? resB : resA;
    const loserBody = (await loser.json()) as { error: { kind: string } };
    expect(loserBody.error.kind).toBe("already_running");

    // Exactly ONE running row and exactly ONE cheap-model call fired.
    const runningRows = await auditRowFor(userId);
    expect(runningRows).toHaveLength(1);
    expect(runningRows[0].status).toBe("running");
    expect(cheap.callCount()).toBe(1);
    expect(strong.callCount()).toBe(0);

    // Release the winner and let it finish so nothing dangles.
    gate.resolve();
    await collectSse(winner);
    await flushAfter();
    expect(cheap.callCount()).toBe(1);
    const rows = await auditRowFor(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("completed");
  });
});

describe("POST /api/audit — stale running row (orphan recovery)", () => {
  it("marks a running row older than maxDuration failed and starts a fresh audit", async () => {
    const userId = await seedUser();
    await seedOpenAiKey(userId);
    const documentId = await seedDocument(userId, { rawContent: ARTICLE, wordCount: 60 });
    H.session = { user: { id: userId } };

    // An orphaned running row for the exact cache key the route will compute,
    // aged past the 300s function ceiling — its owner is dead; it can never
    // complete, and it must not block re-runs forever.
    const contentHash = createHash("sha256").update(canonicalize(ARTICLE)).digest("hex");
    const [orphan] = await dbProxy
      .insert(audits)
      .values({
        documentId,
        userId,
        contentHash,
        rubricVersion: RUBRIC_VERSION,
        signalsVersion: "v1.0.0",
        modelId: modelIdFor("openai", "cheap"),
        createdAt: new Date(Date.now() - 301_000),
      })
      .returning({ id: audits.id });

    const cheap = scriptModel(rubricResponse(70), { modelId: "mock-cheap" });
    const strong = scriptModel(rewriteResponse(), { modelId: "mock-strong" });
    installModels(cheap, strong);

    // Act — a fresh POST must not 409 on the orphan.
    const res = await POST(auditRequest(documentId));
    expect(res.status).toBe(200);
    const events = await collectSse(res);
    await flushAfter();

    // Assert — the fresh audit ran and completed; the orphan was failed, not returned.
    expect(eventTypes(events)).toContain("done");
    expect(cheap.callCount()).toBe(1);
    const rows = await auditRowFor(userId);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === orphan.id)?.status).toBe("failed");
    expect(rows.filter((r) => r.status === "completed")).toHaveLength(1);
  });
});

describe("POST /api/audit — durable persistence race tolerance", () => {
  it("never rejects the after() task when a concurrent completed row already exists", async () => {
    const userId = await seedUser();
    await seedOpenAiKey(userId);
    const documentId = await seedDocument(userId, { rawContent: ARTICLE, wordCount: 60 });
    H.session = { user: { id: userId } };
    const gate = deferred();
    installModels(
      scriptModel(rubricResponse(70), { modelId: "mock-cheap", gate: gate.promise }),
      scriptModel(rewriteResponse(), { modelId: "mock-strong" }),
    );

    // Start audit A; it inserts a running row and parks on the gated model.
    const resA = await POST(auditRequest(documentId));
    const [runningRow] = await auditRowFor(userId);
    expect(runningRow.status).toBe("running");

    // A racer "wins": a completed row for the same cache key lands while A is
    // still in flight (simulated directly at the DB layer).
    await dbProxy.insert(audits).values({
      documentId,
      userId,
      status: "completed",
      contentHash: runningRow.contentHash,
      rubricVersion: runningRow.rubricVersion,
      signalsVersion: runningRow.signalsVersion,
      modelId: runningRow.modelId,
      scoresStatus: "done",
      rewritesStatus: "done",
      completedAt: new Date(),
    });

    // Release A. Its completed UPDATE now collides with the completed
    // partial-unique index; the loser must mark itself failed instead of
    // rejecting the after() task (Promise.all — NOT allSettled — so a
    // rejection would fail this test).
    gate.resolve();
    await collectSse(resA);
    await Promise.all(H.afterTasks.splice(0));

    const rows = await auditRowFor(userId);
    expect(rows.find((r) => r.id === runningRow.id)?.status).toBe("failed");
    expect(rows.filter((r) => r.status === "completed")).toHaveLength(1);
  });
});

describe("POST /api/audit — cache hit", () => {
  it("re-running a completed audit makes zero LLM calls", async () => {
    // Arrange — first run completes the audit.
    const userId = await seedUser();
    await seedOpenAiKey(userId);
    const documentId = await seedDocument(userId, { rawContent: ARTICLE, wordCount: 60 });
    H.session = { user: { id: userId } };
    installModels(
      scriptModel(rubricResponse(70), { modelId: "mock-cheap" }),
      scriptModel(rewriteResponse(), { modelId: "mock-strong" }),
    );
    await collectSse(await POST(auditRequest(documentId)));
    await flushAfter();

    // Act — second run against the same content, with fresh (call-counted) models.
    const cheap2 = scriptModel(rubricResponse(70), { modelId: "mock-cheap" });
    const strong2 = scriptModel(rewriteResponse(), { modelId: "mock-strong" });
    installModels(cheap2, strong2);
    const res2 = await POST(auditRequest(documentId));
    const events = await collectSse(res2);

    // Assert — served from cache, no new LLM calls, no new durable work scheduled.
    expect(res2.status).toBe(200);
    expect(cheap2.callCount()).toBe(0);
    expect(strong2.callCount()).toBe(0);
    expect(eventTypes(events)).toContain("scores");
    expect(eventTypes(events)).toContain("done");
    expect(H.afterTasks).toHaveLength(0);
    // Still exactly one persisted audit row (the cache hit did not insert another).
    expect(await auditRowFor(userId)).toHaveLength(1);
  });
});

describe("POST /api/audit — partial failure (call 2 throws)", () => {
  it("persists the scores, marks rewrites failed, and recovery surfaces the scores", async () => {
    // Arrange — call 1 succeeds, call 2 (generator) throws.
    const userId = await seedUser();
    await seedOpenAiKey(userId);
    const documentId = await seedDocument(userId, { rawContent: ARTICLE, wordCount: 60 });
    H.session = { user: { id: userId } };
    const cheap = scriptModel(rubricResponse(65), { modelId: "mock-cheap" });
    const strong = scriptModel(null, { modelId: "mock-strong", fail: new Error("generator boom") });
    installModels(cheap, strong);

    // Act
    const events = await collectSse(await POST(auditRequest(documentId)));
    await flushAfter();

    // Assert — scores survived, rewrites failed, audit is completed (partial).
    expect(eventTypes(events)).toContain("signals");
    expect(eventTypes(events)).toContain("scores");
    const rows = await auditRowFor(userId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.scoresStatus).toBe("done");
    expect(row.rewritesStatus).toBe("failed");
    expect(row.status).toBe("completed");
    expect(row.scores).not.toBeNull();
    expect(row.error).not.toBeNull();

    // Assert — the recovery read (getAuditStatus) surfaces the persisted scores.
    H.session = { user: { id: userId } };
    const recovered = await getAuditStatus(row.id);
    expect(recovered).not.toBeNull();
    expect(recovered?.scores).not.toBeNull();
    expect(recovered?.rewritesStatus).toBe("failed");
    expect(recovered?.scoresStatus).toBe("done");
  });
});

describe("POST /api/audit — rate limit", () => {
  it("rejects the request past the per-user window with 429", async () => {
    // Arrange — one user, one doc; hold call 1 open so allowed audits stay running
    // (each still consumes a rate-limit token) and none complete into a cache hit.
    const userId = await seedUser();
    await seedOpenAiKey(userId);
    const documentId = await seedDocument(userId, { rawContent: ARTICLE, wordCount: 60 });
    H.session = { user: { id: userId } };
    const gate = deferred();
    installModels(
      scriptModel(rubricResponse(70), { modelId: "mock-cheap", gate: gate.promise }),
      scriptModel(rewriteResponse(), { modelId: "mock-strong" }),
    );

    // Act — AUDIT_USER_LIMIT is 10; the 11th call in the window must be rejected.
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await POST(auditRequest(documentId));
      statuses.push(res.status);
      // Drain non-streaming (409/429) bodies; leave the first streaming one alone.
      if (res.status !== 200) await res.json().catch(() => null);
    }

    // Assert — the last call is rate-limited, and it advertises Retry-After.
    const last = statuses[statuses.length - 1];
    expect(last).toBe(429);
    expect(statuses.slice(0, 10).every((s) => s === 200 || s === 409)).toBe(true);

    // Release the gated in-flight audit so nothing dangles.
    gate.resolve();
    await flushAfter();
  });

  it("returns a Retry-After header on the 429", async () => {
    const userId = await seedUser();
    await seedOpenAiKey(userId);
    const documentId = await seedDocument(userId, { rawContent: ARTICLE, wordCount: 60 });
    H.session = { user: { id: userId } };
    const gate = deferred();
    installModels(
      scriptModel(rubricResponse(70), { modelId: "mock-cheap", gate: gate.promise }),
      scriptModel(rewriteResponse(), { modelId: "mock-strong" }),
    );

    let limited: Response | null = null;
    for (let i = 0; i < 11; i++) {
      const res = await POST(auditRequest(documentId));
      if (res.status === 429) {
        limited = res;
        break;
      }
      if (res.status !== 200) await res.json().catch(() => null);
    }

    expect(limited).not.toBeNull();
    expect(limited?.headers.get("Retry-After")).toBeTruthy();
    gate.resolve();
    await flushAfter();
  });
});

describe("audits partial-unique idempotency indexes (PGlite-enforced)", () => {
  it("rejects duplicate completed AND duplicate running rows for the same cache key", async () => {
    const userId = await seedUser();
    const documentId = await seedDocument(userId, { rawContent: ARTICLE, wordCount: 60 });
    const cacheKey = {
      userId,
      documentId,
      contentHash: "hash-abc",
      rubricVersion: RUBRIC_VERSION,
      signalsVersion: "v1.0.0",
      modelId: "gpt-5-mini",
    };

    // First completed row: fine.
    await dbProxy.insert(audits).values({ ...cacheKey, status: "completed" });

    // Second completed row, identical cache key: the partial unique index rejects it.
    await expect(
      dbProxy.insert(audits).values({ ...cacheKey, status: "completed" }),
    ).rejects.toThrow();

    // ONE running row alongside the completed one is allowed (neither partial
    // index covers the other's status)...
    await expect(
      dbProxy.insert(audits).values({ ...cacheKey, status: "running" }),
    ).resolves.not.toThrow();

    // ...but a SECOND running row for the same key is rejected by the running
    // partial index — this is what makes the route's insert-first guard atomic.
    await expect(
      dbProxy.insert(audits).values({ ...cacheKey, status: "running" }),
    ).rejects.toThrow();

    // Failed rows are covered by neither index, so retries can accumulate.
    await expect(
      dbProxy.insert(audits).values({ ...cacheKey, status: "failed" }),
    ).resolves.not.toThrow();

    const completed = await dbProxy
      .select()
      .from(audits)
      .where(and(eq(audits.userId, userId), eq(audits.status, "completed")));
    expect(completed).toHaveLength(1);
  });
});
