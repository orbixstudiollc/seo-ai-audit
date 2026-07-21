import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditStreamEvent } from "@/lib/audit/types";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rateLimit: vi.fn(),
  ownerHash: vi.fn(),
  dfsConfigured: vi.fn(),
  reserveSpend: vi.fn(),
  cancelSpend: vi.fn(),
  runSerpLive: vi.fn(),
  runPageAudit: vi.fn(),
}));

vi.mock("@/lib/cloud/server", () => ({
  cloudHistoryConfigured: () => true,
  resolveOwnerHashFromRequest: mocks.ownerHash,
  getSupabaseAdmin: () => ({ from: mocks.from }),
}));
vi.mock("@/lib/dataforseo", () => ({ dataForSeoConfigured: mocks.dfsConfigured }));
// The real limiter is module-level in-memory state; unmocked, this suite's
// repeated POSTs would drain the 2/min bucket and fail later cases.
vi.mock("@/lib/audit/ratelimit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("@/lib/providers/budget", () => ({ reserveSpend: mocks.reserveSpend, cancelSpend: mocks.cancelSpend }));
vi.mock("@/lib/dataforseo/serp", () => ({ SERP_EST_COST_USD: 0.01, runSerpLive: mocks.runSerpLive }));
vi.mock("@/lib/audit/pageAudit", () => ({ runPageAudit: mocks.runPageAudit }));

import { GET, POST } from "@/app/api/skills/compare/route";

// --- helpers -------------------------------------------------------------

type ChainResult = { data?: unknown; error?: unknown };

function chain(result: ChainResult) {
  const value: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (onFulfilled: (v: ChainResult) => unknown) => Promise<unknown>;
  } = {} as never;
  for (const method of ["select", "eq", "order", "limit", "insert", "update", "delete", "upsert"]) {
    value[method] = vi.fn(() => value);
  }
  value.maybeSingle = vi.fn(async () => result);
  value.single = vi.fn(async () => result);
  value.then = (onFulfilled) => Promise.resolve(result).then(onFulfilled);
  return value;
}

function reservedRow(id: string) {
  return { id, audit_id: "audit-1", provider_task_id: null, status: "creating", request: { skillId: "compare" }, result_meta: {}, created_at: "t", updated_at: "t" };
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/skills/compare", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function getRequest(id: string): Request {
  return new Request(`http://localhost/api/skills/compare?id=${encodeURIComponent(id)}`);
}

/** Drain an SSE response body into its parsed `data:` frames — this route's
 * two-frame vocabulary (compare:progress / compare:done) is route-local, so
 * this reads raw JSON rather than reusing test/helpers/sse.ts's typed parsers. */
async function collectFrames(response: Response): Promise<Array<Record<string, unknown>>> {
  if (!response.body) throw new Error("Response has no body to stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: Array<Record<string, unknown>> = [];
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLines = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart());
      if (dataLines.length > 0) {
        try {
          events.push(JSON.parse(dataLines.join("\n")));
        } catch {
          // heartbeat/malformed frame — skip
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  return events;
}

function successfulPageAudit() {
  return async (_url: string, _target: URL, write: (e: AuditStreamEvent) => void) => {
    const scores = { aeo: 70, geo: 60, citability: 55, aiOverview: 50 };
    const lenses = Object.fromEntries(
      Object.entries(scores).map(([lens, score]) => [lens, { lens, score, capped: false }]),
    );
    write({
      type: "scores",
      scores: { lenses, signals: {}, rubricVersion: "v1", signalsVersion: "v1", modelId: "test" } as never,
      findings: { questionGaps: [], anchorSuggestions: [], blockers: [], qaPairs: [], quotables: [] },
    });
    write({ type: "done" });
  };
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rateLimit.mockReset();
  mocks.rateLimit.mockReturnValue({ allowed: true, retryAfterSec: 0 });
  mocks.ownerHash.mockReset();
  mocks.ownerHash.mockResolvedValue("owner-hash");
  mocks.dfsConfigured.mockReset();
  mocks.dfsConfigured.mockReturnValue(true);
  mocks.reserveSpend.mockReset();
  mocks.reserveSpend.mockResolvedValue({ allowed: true });
  mocks.cancelSpend.mockReset();
  mocks.runSerpLive.mockReset();
  mocks.runPageAudit.mockReset();
});

describe("POST /api/skills/compare — gates", () => {
  it("rejects over the per-minute IP bucket before resolving the owner", async () => {
    mocks.rateLimit.mockReturnValue({ allowed: false, retryAfterSec: 30 });
    const response = await POST(postRequest({ auditId: "audit-1", keyword: "oat milk" }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limit", retryAfter: 30 });
    expect(mocks.ownerHash).not.toHaveBeenCalled();
  });

  it("returns 503 provider_unavailable when DataForSEO isn't configured", async () => {
    mocks.dfsConfigured.mockReturnValue(false);
    const response = await POST(postRequest({ auditId: "audit-1", keyword: "oat milk" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "provider_unavailable" });
    expect(mocks.runSerpLive).not.toHaveBeenCalled();
  });

  it("rejects topN above MAX_COMPETITORS (3) with 400 invalid_scope", async () => {
    const response = await POST(postRequest({ auditId: "audit-1", keyword: "oat milk", topN: 4 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_scope" });
  });

  it("rejects an empty keyword with 400 invalid_scope", async () => {
    const response = await POST(postRequest({ auditId: "audit-1", keyword: "" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_scope" });
  });

  it("returns 404 audit_not_found when the auditId isn't owned by this caller", async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: null }));
    const response = await POST(postRequest({ auditId: "audit-1", keyword: "oat milk" }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "audit_not_found" });
    expect(mocks.runSerpLive).not.toHaveBeenCalled();
  });
});

describe("POST /api/skills/compare — budget denied", () => {
  it("streams compare:done with the failed task and runs zero page audits", async () => {
    const auditOwnership = chain({ data: { id: "audit-1", url: "https://mine.test/" }, error: null });
    const none = chain({ data: null, error: null });
    mocks.from.mockImplementation((table: string) => (table === "audit_runs" ? auditOwnership : none));
    mocks.reserveSpend.mockResolvedValue({ allowed: false, reason: "owner" });

    const response = await POST(postRequest({ auditId: "audit-1", keyword: "oat milk" }));
    expect(response.status).toBe(200);
    const frames = await collectFrames(response);

    expect(frames.filter((f) => f.type === "compare:progress")).toHaveLength(0);
    expect(frames).toHaveLength(1);
    const done = frames[0] as { type: string; task: { status: string; error?: { kind: string } } };
    expect(done.type).toBe("compare:done");
    expect(done.task.status).toBe("failed");
    expect(done.task.error?.kind).toBe("budget_exceeded");
    expect(mocks.runPageAudit).not.toHaveBeenCalled();
  });
});

describe("POST /api/skills/compare — happy path", () => {
  it("streams a progress frame per competitor, then compare:done with a persisted complete task", async () => {
    const auditOwnership = chain({ data: { id: "audit-1", url: "https://mine.test/" }, error: null });
    const none = chain({ data: null, error: null });
    const reserved = chain({ data: reservedRow("task-1"), error: null });
    const update = chain({ data: null, error: null });
    const ledger = chain({ data: null, error: null });
    const mineRow = chain({ data: { scores: { aeo: 80, geo: 70, citability: 65, aiOverview: 60 } }, error: null });

    let auditRunsCalls = 0;
    let providerTaskCalls = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === "usage_ledger") return ledger;
      if (table === "audit_runs") {
        auditRunsCalls += 1;
        return auditRunsCalls === 1 ? auditOwnership : mineRow;
      }
      providerTaskCalls += 1;
      if (providerTaskCalls === 1) return none; // latestTask — no reuse
      if (providerTaskCalls === 2) return reserved; // reserveTask
      return update; // runPaidSkill's completion update + persistCompareResult
    });

    mocks.runSerpLive.mockResolvedValue({
      result: {
        keyword: "oat milk",
        capturedAt: "t",
        entries: [
          { rank: 1, url: "https://mine.test/", title: "Mine", domain: "mine.test", isOwn: true },
          { rank: 2, url: "https://a.test/1", title: "A", domain: "a.test", isOwn: false },
        ],
      },
      costUsd: 0.009,
    });
    mocks.runPageAudit.mockImplementation(successfulPageAudit());

    const response = await POST(postRequest({ auditId: "audit-1", keyword: "oat milk", topN: 3 }));
    expect(response.status).toBe(200);
    const frames = await collectFrames(response);

    expect(frames.map((f) => f.type)).toEqual(["compare:progress", "compare:done"]);
    expect(frames[0]).toEqual({ type: "compare:progress", completed: 1, total: 1 });

    const done = frames[1] as { type: string; task: { status: string; result: { competitors: unknown[]; mine: unknown } } };
    expect(done.task.status).toBe("complete");
    expect(done.task.result.competitors).toHaveLength(1);
    expect(done.task.result.mine).toEqual({ url: "https://mine.test/", scores: { aeo: 80, geo: 70, citability: 65, aiOverview: 60 } });

    // The reserved row got overwritten with the full CompareSkillResult (persistCompareResult).
    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({ result_meta: expect.objectContaining({ result: expect.objectContaining({ competitors: expect.any(Array) }) }) }),
    );
  });
});

describe("GET /api/skills/compare", () => {
  it("returns 404 task_not_found when no row exists", async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: null }));
    const response = await GET(getRequest("missing-id"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "task_not_found" });
  });

  it("does not rate-limit or provider-check a task read", async () => {
    mocks.rateLimit.mockReturnValue({ allowed: false, retryAfterSec: 60 });
    mocks.dfsConfigured.mockReturnValue(false);
    mocks.from.mockReturnValue(chain({ data: null, error: null }));
    const response = await GET(getRequest("missing-id"));
    expect(response.status).toBe(404); // not 429/503 — read gate skips both checks
  });
});
