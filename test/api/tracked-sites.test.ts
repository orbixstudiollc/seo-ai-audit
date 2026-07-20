import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rateLimit: vi.fn(),
  assertSafe: vi.fn(),
}));

vi.mock("@/lib/cloud/server", () => ({
  cloudHistoryConfigured: () => true,
  resolveOwnerHashFromRequest: async () => "owner-hash",
  getSupabaseAdmin: () => ({ from: mocks.from }),
}));

// Module-level in-memory bucket: unmocked, the suite's own POSTs would drain it.
vi.mock("@/lib/audit/ratelimit", () => ({
  checkRateLimit: mocks.rateLimit,
}));

// assertSafeUrl does live DNS resolution — stub it for unit tests.
vi.mock("@/lib/import/ssrfGuard", () => ({
  assertSafeUrl: mocks.assertSafe,
}));

import { ImportError } from "@/lib/import/errors";
import { DELETE, GET, POST } from "@/app/api/tracked-sites/route";

type ChainResult = { data?: unknown; error?: unknown; count?: number | null };

function chain(result: ChainResult) {
  const value: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (onFulfilled: (v: ChainResult) => unknown) => Promise<unknown>;
  } = {} as never;
  for (const method of ["select", "eq", "neq", "or", "order", "limit", "lt", "not", "is", "insert", "update", "delete", "upsert"]) {
    value[method] = vi.fn(() => value);
  }
  value.maybeSingle = vi.fn(async () => result);
  value.single = vi.fn(async () => result);
  value.then = (onFulfilled) => Promise.resolve(result).then(onFulfilled);
  return value;
}

function jsonRequest(method: string, body: unknown): Request {
  return new Request("http://localhost/api/tracked-sites", {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rateLimit.mockReset();
  mocks.rateLimit.mockReturnValue({ allowed: true, retryAfterSec: 0 });
  mocks.assertSafe.mockReset();
  mocks.assertSafe.mockImplementation(async (url: string) => ({
    url: new URL(url),
    dispatcher: { close: async () => undefined },
  }));
});

describe("tracked-sites POST gate order", () => {
  it("rejects over the per-IP bucket before touching validation or the database", async () => {
    mocks.rateLimit.mockReturnValue({ allowed: false, retryAfterSec: 42 });
    const response = await POST(jsonRequest("POST", { url: "https://example.com/" }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limit", retryAfter: 42 });
    expect(mocks.assertSafe).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects malformed urls with invalid_url before the SSRF guard", async () => {
    const response = await POST(jsonRequest("POST", { url: "not-a-url" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_url" });
    expect(mocks.assertSafe).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects SSRF-unsafe urls with invalid_url before any database read", async () => {
    mocks.assertSafe.mockRejectedValue(new ImportError("blocked", "private address"));
    const response = await POST(jsonRequest("POST", { url: "https://internal.example/" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_url" });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("returns 404 audit_required when the owner never audited this exact url", async () => {
    const runs = chain({ data: null, error: null });
    const tracked = chain({ data: null, error: null });
    mocks.from.mockImplementation((table: string) => (table === "audit_runs" ? runs : tracked));
    const response = await POST(jsonRequest("POST", { url: "https://example.com/" }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "audit_required" });
    expect(tracked.upsert).not.toHaveBeenCalled();
  });

  it("returns 409 limit_reached at ten OTHER tracked sites and never upserts", async () => {
    const runs = chain({ data: { id: "audit-1" }, error: null });
    const tracked = chain({ count: 10, error: null });
    mocks.from.mockImplementation((table: string) => (table === "audit_runs" ? runs : tracked));
    const response = await POST(jsonRequest("POST", { url: "https://example.com/" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "limit_reached" });
    // The owner-count excludes the posted url, so a RE-track never 409s.
    expect(tracked.neq).toHaveBeenCalledWith("url", "https://example.com/");
    expect(tracked.upsert).not.toHaveBeenCalled();
  });

  it("returns 503 capacity at the deployment-wide ceiling and never upserts", async () => {
    const runs = chain({ data: { id: "audit-1" }, error: null });
    const ownerCount = chain({ count: 3, error: null });
    const globalCount = chain({ count: 500, error: null });
    let trackedCalls = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === "audit_runs") return runs;
      trackedCalls += 1;
      return trackedCalls === 1 ? ownerCount : globalCount;
    });
    const response = await POST(jsonRequest("POST", { url: "https://example.com/" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "capacity" });
    expect(globalCount.upsert).not.toHaveBeenCalled();
  });

  it("upserts and returns 201 with the tracked site once every gate passes", async () => {
    const runs = chain({ data: { id: "audit-1" }, error: null });
    const tracked = chain({
      data: { url: "https://example.com/", created_at: "2026-07-20T00:00:00.000Z", last_run_at: null },
      error: null,
      count: 3,
    });
    mocks.from.mockImplementation((table: string) => (table === "audit_runs" ? runs : tracked));
    const response = await POST(jsonRequest("POST", { url: "https://example.com/" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      site: { url: "https://example.com/", createdAt: "2026-07-20T00:00:00.000Z", lastRunAt: null },
    });
    expect(tracked.upsert).toHaveBeenCalledWith(
      { owner_hash: "owner-hash", url: "https://example.com/" },
      { onConflict: "owner_hash,url" },
    );
  });
});

describe("tracked-sites GET", () => {
  it("lists the owner's tracked sites", async () => {
    const tracked = chain({
      data: [{ url: "https://example.com/", created_at: "2026-07-20T00:00:00.000Z", last_run_at: "2026-07-20T03:00:00.000Z" }],
      error: null,
    });
    mocks.from.mockReturnValue(tracked);
    const response = await GET(new Request("http://localhost/api/tracked-sites"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sites: [{ url: "https://example.com/", createdAt: "2026-07-20T00:00:00.000Z", lastRunAt: "2026-07-20T03:00:00.000Z" }],
    });
  });
});

describe("tracked-sites DELETE", () => {
  it("is idempotent: deleting an untracked url still returns ok", async () => {
    const tracked = chain({ data: null, error: null });
    mocks.from.mockReturnValue(tracked);
    const response = await DELETE(jsonRequest("DELETE", { url: "https://example.com/" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(tracked.delete).toHaveBeenCalled();
  });
});
