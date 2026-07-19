import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  configured: vi.fn(() => true),
  start: vi.fn(),
  poll: vi.fn(),
}));

vi.mock("@/lib/cloud/server", () => ({
  cloudHistoryConfigured: () => true,
  ownerHashFromRequest: () => "owner-hash",
  getSupabaseAdmin: () => ({ from: mocks.from }),
}));

vi.mock("@/lib/dataforseo", () => ({
  dataForSeoConfigured: mocks.configured,
  startOnPageTask: mocks.start,
  pollOnPageTask: mocks.poll,
}));

import { GET, POST } from "@/app/api/technical-audit/route";

const row = {
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
