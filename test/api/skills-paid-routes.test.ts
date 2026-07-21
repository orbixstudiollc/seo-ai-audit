import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rateLimit: vi.fn(),
  ownerHash: vi.fn(),
  dfsConfigured: vi.fn(),
  reserveSpend: vi.fn(),
  cancelSpend: vi.fn(),
  runSerpLive: vi.fn(),
  runKeywordsLive: vi.fn(),
  runLabsLive: vi.fn(),
  runBacklinksLive: vi.fn(),
}));

vi.mock("@/lib/cloud/server", () => ({
  cloudHistoryConfigured: () => true,
  resolveOwnerHashFromRequest: mocks.ownerHash,
  getSupabaseAdmin: () => ({ from: mocks.from }),
}));

vi.mock("@/lib/dataforseo", () => ({
  dataForSeoConfigured: mocks.dfsConfigured,
}));

// The real limiter is module-level in-memory state; unmocked, the suite's own
// repeated POSTs would drain the 3/min bucket and fail later cases.
vi.mock("@/lib/audit/ratelimit", () => ({
  checkRateLimit: mocks.rateLimit,
}));

vi.mock("@/lib/providers/budget", () => ({
  reserveSpend: mocks.reserveSpend,
  cancelSpend: mocks.cancelSpend,
}));

vi.mock("@/lib/dataforseo/serp", () => ({ SERP_EST_COST_USD: 0.01, runSerpLive: mocks.runSerpLive }));
vi.mock("@/lib/dataforseo/keywords", () => ({ KEYWORDS_EST_COST_USD: 0.08, MAX_KEYWORDS: 100, runKeywordsLive: mocks.runKeywordsLive }));
vi.mock("@/lib/dataforseo/labs", () => ({ LABS_EST_COST_USD: 0.03, runLabsLive: mocks.runLabsLive }));
vi.mock("@/lib/dataforseo/backlinks", () => ({ BACKLINKS_EST_COST_USD: 0.03, runBacklinksLive: mocks.runBacklinksLive }));

import { GET as backlinksGET, POST as backlinksPOST } from "@/app/api/skills/backlinks/route";
import { GET as keywordsGET, POST as keywordsPOST } from "@/app/api/skills/keywords/route";
import { GET as labsGET, POST as labsPOST } from "@/app/api/skills/labs/route";
import { GET as serpGET, POST as serpPOST } from "@/app/api/skills/serp/route";

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
  return { id, audit_id: "audit-1", provider_task_id: null, status: "creating", request: {}, result_meta: {}, created_at: "t", updated_at: "t" };
}

function postRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function getRequest(path: string, id: string): Request {
  return new Request(`http://localhost${path}?id=${encodeURIComponent(id)}`);
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
  mocks.cancelSpend.mockResolvedValue(undefined);
  mocks.runSerpLive.mockReset();
  mocks.runKeywordsLive.mockReset();
  mocks.runLabsLive.mockReset();
  mocks.runBacklinksLive.mockReset();
});

describe("POST /api/skills/serp", () => {
  it("rejects over the per-minute IP bucket before resolving the owner", async () => {
    mocks.rateLimit.mockReturnValue({ allowed: false, retryAfterSec: 30 });
    const response = await serpPOST(postRequest("/api/skills/serp", { auditId: "audit-1", scope: { kind: "keyword", keyword: "seo audit" } }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limit", retryAfter: 30 });
    expect(mocks.ownerHash).not.toHaveBeenCalled();
  });

  it("returns 503 provider_unavailable when DataForSEO isn't configured", async () => {
    mocks.dfsConfigured.mockReturnValue(false);
    const response = await serpPOST(postRequest("/api/skills/serp", { auditId: "audit-1", scope: { kind: "keyword", keyword: "seo audit" } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "provider_unavailable" });
    expect(mocks.runSerpLive).not.toHaveBeenCalled();
  });

  it("rejects an invalid scope shape with 400 invalid_scope", async () => {
    const response = await serpPOST(postRequest("/api/skills/serp", { auditId: "audit-1", scope: { kind: "site", url: "https://example.com" } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_scope" });
    expect(mocks.runSerpLive).not.toHaveBeenCalled();
  });

  it("runs the live SERP lookup and returns the completed task", async () => {
    const audit = chain({ data: { id: "audit-1", url: "https://example.com" }, error: null });
    const none = chain({ data: null, error: null });
    const update = chain({ data: null, error: null });
    const ledger = chain({ data: null, error: null });
    let providerCalls = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === "audit_runs") return audit;
      if (table === "usage_ledger") return ledger;
      providerCalls += 1;
      if (providerCalls === 1) return none;
      if (providerCalls === 2) return chain({ data: reservedRow("task-1"), error: null });
      return update;
    });
    mocks.runSerpLive.mockResolvedValue({ result: { keyword: "seo audit", capturedAt: "t", entries: [] }, costUsd: 0.009 });

    const response = await serpPOST(postRequest("/api/skills/serp", { auditId: "audit-1", scope: { kind: "keyword", keyword: "seo audit" } }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.reused).toBe(false);
    expect(body.task.status).toBe("complete");
    expect(mocks.runSerpLive).toHaveBeenCalledWith({ keyword: "seo audit", ownHost: "example.com" });
  });
});

describe("GET /api/skills/serp", () => {
  it("returns 404 task_not_found when no row exists", async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: null }));
    const response = await serpGET(getRequest("/api/skills/serp", "missing-id"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "task_not_found" });
  });
});

describe("POST /api/skills/keywords", () => {
  it("rejects over the per-minute IP bucket before resolving the owner", async () => {
    mocks.rateLimit.mockReturnValue({ allowed: false, retryAfterSec: 12 });
    const response = await keywordsPOST(postRequest("/api/skills/keywords", { auditId: "audit-1", scope: { kind: "keyword", keyword: "seo audit" } }));
    expect(response.status).toBe(429);
    expect(mocks.ownerHash).not.toHaveBeenCalled();
  });

  it("rejects an invalid scope shape with 400 invalid_scope", async () => {
    const response = await keywordsPOST(postRequest("/api/skills/keywords", { auditId: "audit-1", scope: { kind: "site", url: "https://example.com" } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_scope" });
    expect(mocks.runKeywordsLive).not.toHaveBeenCalled();
  });

  it("defaults to the scope keyword when no explicit keyword list is given", async () => {
    const audit = chain({ data: { id: "audit-1", url: "https://example.com" }, error: null });
    const none = chain({ data: null, error: null });
    const update = chain({ data: null, error: null });
    const ledger = chain({ data: null, error: null });
    let providerCalls = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === "audit_runs") return audit;
      if (table === "usage_ledger") return ledger;
      providerCalls += 1;
      if (providerCalls === 1) return none;
      if (providerCalls === 2) return chain({ data: reservedRow("task-1"), error: null });
      return update;
    });
    mocks.runKeywordsLive.mockResolvedValue({ result: { rows: [] }, costUsd: 0.07 });

    const response = await keywordsPOST(postRequest("/api/skills/keywords", { auditId: "audit-1", scope: { kind: "keyword", keyword: "seo audit" } }));
    expect(response.status).toBe(200);
    expect(mocks.runKeywordsLive).toHaveBeenCalledWith({ keywords: ["seo audit"] });
  });
});

describe("GET /api/skills/keywords", () => {
  it("returns 404 task_not_found when no row exists", async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: null }));
    const response = await keywordsGET(getRequest("/api/skills/keywords", "missing-id"));
    expect(response.status).toBe(404);
  });
});

describe("POST /api/skills/labs", () => {
  it("returns 503 provider_unavailable when DataForSEO isn't configured", async () => {
    mocks.dfsConfigured.mockReturnValue(false);
    const response = await labsPOST(postRequest("/api/skills/labs", { auditId: "audit-1", scope: { kind: "site", url: "https://example.com" } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "provider_unavailable" });
  });

  it("rejects a scope url whose host doesn't match the audited site with 400 audit_target_mismatch", async () => {
    mocks.from.mockReturnValue(chain({ data: { id: "audit-1", url: "https://example.com" }, error: null }));
    const response = await labsPOST(postRequest("/api/skills/labs", { auditId: "audit-1", scope: { kind: "site", url: "https://other.example" } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "audit_target_mismatch" });
    expect(mocks.runLabsLive).not.toHaveBeenCalled();
  });

  it("runs the live ranked-keywords lookup for a matching host", async () => {
    const audit = chain({ data: { id: "audit-1", url: "https://example.com" }, error: null });
    const none = chain({ data: null, error: null });
    const update = chain({ data: null, error: null });
    const ledger = chain({ data: null, error: null });
    let providerCalls = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === "audit_runs") return audit;
      if (table === "usage_ledger") return ledger;
      providerCalls += 1;
      if (providerCalls === 1) return none;
      if (providerCalls === 2) return chain({ data: reservedRow("task-2"), error: null });
      return update;
    });
    mocks.runLabsLive.mockResolvedValue({ result: { rows: [] }, costUsd: 0.02 });

    const response = await labsPOST(postRequest("/api/skills/labs", { auditId: "audit-1", scope: { kind: "site", url: "https://www.example.com/" } }));
    expect(response.status).toBe(200);
    expect(mocks.runLabsLive).toHaveBeenCalledWith({ domain: "example.com" });
  });
});

describe("GET /api/skills/labs", () => {
  it("returns 404 task_not_found when no row exists", async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: null }));
    const response = await labsGET(getRequest("/api/skills/labs", "missing-id"));
    expect(response.status).toBe(404);
  });
});

describe("POST /api/skills/backlinks", () => {
  it("rejects an invalid scope shape with 400 invalid_scope", async () => {
    const response = await backlinksPOST(postRequest("/api/skills/backlinks", { auditId: "audit-1", scope: { kind: "keyword", keyword: "seo audit" } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_scope" });
  });

  it("rejects a scope url whose host doesn't match the audited site with 400 audit_target_mismatch", async () => {
    mocks.from.mockReturnValue(chain({ data: { id: "audit-1", url: "https://example.com" }, error: null }));
    const response = await backlinksPOST(postRequest("/api/skills/backlinks", { auditId: "audit-1", scope: { kind: "site", url: "https://other.example" } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "audit_target_mismatch" });
    expect(mocks.runBacklinksLive).not.toHaveBeenCalled();
  });
});

describe("GET /api/skills/backlinks", () => {
  it("returns 404 task_not_found when no row exists", async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: null }));
    const response = await backlinksGET(getRequest("/api/skills/backlinks", "missing-id"));
    expect(response.status).toBe(404);
  });
});
