import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  configured: vi.fn(() => true),
  start: vi.fn(),
  poll: vi.fn(),
  rateLimit: vi.fn(),
  reserveSpend: vi.fn(),
  cancelSpend: vi.fn(),
}));

vi.mock("@/lib/cloud/server", () => ({
  cloudHistoryConfigured: () => true,
  resolveOwnerHashFromRequest: async () => "owner-hash",
  getSupabaseAdmin: () => ({ from: mocks.from }),
}));

vi.mock("@/lib/dataforseo", () => ({
  dataForSeoConfigured: mocks.configured,
  startOnPageTask: mocks.start,
  pollOnPageTask: mocks.poll,
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

import { GET, POST } from "@/app/api/technical-audit/route";

const row = {
  id: "task-row-1",
  audit_id: "site:example",
  provider_task_id: "provider-task",
  status: "queued",
  request: { target: "example.com", maxCrawlPages: 500 },
  result_meta: { costUsd: 0.01 },
  created_at: "2026-07-20T00:00:00.000Z",
  updated_at: "2026-07-20T00:00:00.000Z",
};

function chain(result: { data?: unknown; error?: unknown }) {
  const value = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(),
    insert: vi.fn(), upsert: vi.fn(), single: vi.fn(), update: vi.fn(), delete: vi.fn(), is: vi.fn(),
  };
  value.select.mockReturnValue(value); value.eq.mockReturnValue(value); value.order.mockReturnValue(value);
  value.limit.mockReturnValue(value); value.insert.mockReturnValue(value); value.update.mockReturnValue(value);
  value.upsert.mockResolvedValue({ error: null });
  value.delete.mockReturnValue(value); value.is.mockReturnValue(value);
  value.maybeSingle.mockResolvedValue(result); value.single.mockResolvedValue(result);
  return value;
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/technical-audit", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.from.mockReset(); mocks.configured.mockReset(); mocks.configured.mockReturnValue(true);
  mocks.start.mockReset(); mocks.poll.mockReset();
  mocks.rateLimit.mockReset(); mocks.rateLimit.mockReturnValue({ allowed: true, retryAfterSec: 0 });
  mocks.reserveSpend.mockReset(); mocks.reserveSpend.mockResolvedValue({ allowed: true });
  mocks.cancelSpend.mockReset(); mocks.cancelSpend.mockResolvedValue(undefined);
});

describe("technical audit route", () => {
  it("does not create a paid task when provider credentials are absent", async () => {
    mocks.configured.mockReturnValue(false);
    const response = await POST(postRequest({ auditId: "site:example", url: "https://example.com", limit: 500 }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "provider_unavailable" });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("reuses an existing provider task instead of charging twice", async () => {
    const audit = chain({ data: { id: "site:example", url: "https://example.com" }, error: null });
    const existing = chain({ data: row, error: null });
    mocks.from.mockImplementation((table: string) => table === "audit_runs" ? audit : existing);

    const response = await POST(postRequest({ auditId: "site:example", url: "https://www.example.com", limit: 500 }));
    expect(response.status).toBe(200);
    expect((await response.json()).reused).toBe(true);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("does not allow a saved audit id to authorize a different provider target", async () => {
    const audit = chain({ data: { id: "site:example", url: "https://example.com" }, error: null });
    mocks.from.mockReturnValue(audit);
    const response = await POST(postRequest({ auditId: "site:example", url: "https://other.example", limit: 500 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "audit_target_mismatch" });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("starts and records one bounded task plus its actual provider cost", async () => {
    const audit = chain({ data: { id: "site:example", url: "https://example.com" }, error: null });
    const none = chain({ data: null, error: null });
    const inserted = chain({ data: row, error: null });
    const usage = { upsert: vi.fn().mockResolvedValue({ error: null }) };
    let providerCalls = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === "audit_runs") return audit;
      if (table === "usage_ledger") return usage;
      providerCalls += 1;
      return providerCalls === 1 ? none : inserted;
    });
    mocks.start.mockResolvedValue({ taskId: "provider-task", costUsd: 0.01 });

    const response = await POST(postRequest({ auditId: "site:example", url: "https://www.example.com", limit: 500 }));
    expect(response.status).toBe(201);
    expect(mocks.start).toHaveBeenCalledWith({ target: "example.com", maxCrawlPages: 500 });
    expect(usage.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ actual_cost_usd: 0.01 }),
      { onConflict: "owner_hash,audit_id,provider,operation" },
    );
  });

  it("rejects over the per-IP bucket before touching the database", async () => {
    mocks.rateLimit.mockReturnValue({ allowed: false, retryAfterSec: 42 });
    const response = await POST(postRequest({ auditId: "site:example", url: "https://example.com", limit: 500 }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limit", retryAfter: 42 });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("denies with budget_exceeded before reserving a task and never calls the provider", async () => {
    const audit = chain({ data: { id: "site:example", url: "https://example.com" }, error: null });
    const none = chain({ data: null, error: null });
    mocks.from.mockImplementation((table: string) => (table === "audit_runs" ? audit : none));
    mocks.reserveSpend.mockResolvedValue({ allowed: false, reason: "owner" });

    const response = await POST(postRequest({ auditId: "site:example", url: "https://example.com", limit: 500 }));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "budget_exceeded", scope: "owner" });
    expect(mocks.start).not.toHaveBeenCalled();
    expect(none.insert).not.toHaveBeenCalled();
  });

  it("releases only its own reservation (by primary key) and cancels spend when the provider start fails", async () => {
    const audit = chain({ data: { id: "site:example", url: "https://example.com" }, error: null });
    const none = chain({ data: null, error: null });
    const reserved = chain({ data: { ...row, id: "res-1", provider_task_id: null, status: "creating" }, error: null });
    const del = chain({ data: null, error: null });
    let providerCalls = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === "audit_runs") return audit;
      providerCalls += 1;
      if (providerCalls === 1) return none;      // latestTask
      if (providerCalls === 2) return reserved;  // reserveTask insert
      return del;                                // releaseReservation delete
    });
    mocks.start.mockRejectedValue(new Error("provider down"));

    const response = await POST(postRequest({ auditId: "site:example", url: "https://example.com", limit: 500 }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "provider_start_failed" });
    expect(del.delete).toHaveBeenCalled();
    expect(del.eq).toHaveBeenCalledWith("id", "res-1");
    expect(mocks.cancelSpend).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "on_page_task", provider: "dataforseo-onpage" }),
    );
  });

  it("polls a queued task, stores normalized results, and returns completion", async () => {
    const existing = chain({ data: row, error: null });
    const updated = chain({ error: null });
    let providerCalls = 0;
    mocks.from.mockImplementation(() => (++providerCalls === 1 ? existing : updated));
    mocks.poll.mockResolvedValue({
      status: "complete",
      result: { target: "example.com", crawlProgress: "finished", maxCrawlPages: 500, pagesCrawled: 1, pagesInQueue: 0, onpageScore: 80, pages: [] },
    });

    const response = await GET(new Request("http://localhost/api/technical-audit?auditId=site%3Aexample"));
    expect(response.status).toBe(200);
    expect((await response.json()).task.status).toBe("complete");
    expect(mocks.poll).toHaveBeenCalledWith("provider-task", 500);
    expect(updated.update).toHaveBeenCalledWith(expect.objectContaining({ status: "complete" }));
  });
});
