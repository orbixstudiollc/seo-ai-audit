import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rateLimit: vi.fn(),
  configured: vi.fn(),
}));

vi.mock("@/lib/cloud/server", () => ({
  cloudHistoryConfigured: mocks.configured,
  resolveOwnerHashFromRequest: async () => "owner-hash",
  getSupabaseAdmin: () => ({ from: mocks.from }),
}));

// Module-level in-memory bucket: unmocked, the suite's own POSTs would drain it.
vi.mock("@/lib/audit/ratelimit", () => ({
  checkRateLimit: mocks.rateLimit,
}));

import { DELETE, POST } from "@/app/api/share/route";
import { loadSharedReport } from "@/lib/cloud/share";

type ChainResult = { data?: unknown; error?: unknown };

function chain(result: ChainResult) {
  const value: Record<string, ReturnType<typeof vi.fn>> = {} as never;
  for (const method of ["select", "eq", "insert", "update", "delete", "upsert"]) {
    value[method] = vi.fn(() => value);
  }
  value.maybeSingle = vi.fn(async () => result);
  return value;
}

function jsonRequest(method: string, body: unknown): Request {
  return new Request("http://localhost/api/share", {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

const SAVED_REPORT = {
  version: 1, id: "audit-1", kind: "single", createdAt: "2026-07-21T00:00:00.000Z",
  phase: "done", report: { page: {}, scores: {}, findings: [], rewrites: [] }, error: null,
};

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rateLimit.mockReset();
  mocks.rateLimit.mockReturnValue({ allowed: true, retryAfterSec: 0 });
  mocks.configured.mockReset();
  mocks.configured.mockReturnValue(true);
});

describe("share POST", () => {
  it("rejects over the per-IP bucket before touching the database", async () => {
    mocks.rateLimit.mockReturnValue({ allowed: false, retryAfterSec: 42 });
    const response = await POST(jsonRequest("POST", { auditId: "audit-1" }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limit", retryAfter: 42 });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects a missing auditId before any database read", async () => {
    const response = await POST(jsonRequest("POST", {}));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_audit_id" });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("returns 404 when the owner has no stored report for that audit", async () => {
    const reports = chain({ data: null, error: null });
    mocks.from.mockReturnValue(reports);
    const response = await POST(jsonRequest("POST", { auditId: "audit-1" }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "report_not_found" });
  });

  it("mints a 32-hex token scoped to the owner's report and returns it", async () => {
    const reports = chain({ data: { audit_id: "audit-1" }, error: null });
    const links = chain({ data: { token: "a".repeat(32) }, error: null });
    mocks.from.mockImplementation((table: string) => (table === "audit_reports" ? reports : links));
    const response = await POST(jsonRequest("POST", { auditId: "audit-1" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: "a".repeat(32) });
    const upserted = links.upsert.mock.calls[0]?.[0] as { token: string; owner_hash: string; audit_id: string };
    expect(upserted.token).toMatch(/^[0-9a-f]{32}$/);
    expect(upserted.owner_hash).toBe("owner-hash");
    expect(upserted.audit_id).toBe("audit-1");
    expect(links.upsert.mock.calls[0]?.[1]).toEqual({ onConflict: "owner_hash,audit_id", ignoreDuplicates: true });
  });
});

describe("share DELETE", () => {
  it("revokes idempotently", async () => {
    const links = chain({ data: null, error: null });
    mocks.from.mockReturnValue(links);
    const response = await DELETE(jsonRequest("DELETE", { auditId: "audit-1" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(links.delete).toHaveBeenCalled();
  });
});

describe("loadSharedReport", () => {
  it("rejects malformed tokens without touching the database", async () => {
    expect(await loadSharedReport("not-a-token")).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("returns null for an unknown token", async () => {
    const links = chain({ data: null, error: null });
    mocks.from.mockReturnValue(links);
    expect(await loadSharedReport("f".repeat(32))).toBeNull();
  });

  it("resolves a valid token to the stored report payload", async () => {
    const links = chain({ data: { owner_hash: "owner-hash", audit_id: "audit-1" }, error: null });
    const reports = chain({ data: { payload: SAVED_REPORT }, error: null });
    mocks.from.mockImplementation((table: string) => (table === "share_links" ? links : reports));
    expect(await loadSharedReport("f".repeat(32))).toEqual(SAVED_REPORT);
    expect(reports.eq).toHaveBeenCalledWith("owner_hash", "owner-hash");
    expect(reports.eq).toHaveBeenCalledWith("audit_id", "audit-1");
  });

  it("returns null when the stored payload fails report validation", async () => {
    const links = chain({ data: { owner_hash: "owner-hash", audit_id: "audit-1" }, error: null });
    const reports = chain({ data: { payload: { garbage: true } }, error: null });
    mocks.from.mockImplementation((table: string) => (table === "share_links" ? links : reports));
    expect(await loadSharedReport("f".repeat(32))).toBeNull();
  });
});
