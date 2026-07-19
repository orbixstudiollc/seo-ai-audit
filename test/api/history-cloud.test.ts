import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditHistoryRecord } from "@/lib/history";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/lib/cloud/server", () => ({
  cloudHistoryConfigured: () => true,
  ownerHashFromRequest: () => "owner-hash",
  getSupabaseAdmin: () => ({ from: mocks.from }),
}));

import { GET, POST, PUT } from "@/app/api/history/route";

const record: AuditHistoryRecord = {
  id: "single:test",
  version: 4,
  url: "https://example.com/article",
  finalUrl: "https://example.com/article",
  title: "Example article",
  mode: "single",
  createdAt: "2026-07-20T00:00:00.000Z",
  status: "complete",
  scores: { aeo: 80, geo: 70, citability: 60, aiOverview: 50 },
  reportAvailable: true,
};

function request(method: string, body?: unknown): Request {
  return new Request("http://localhost/api/history", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => mocks.from.mockReset());

describe("configured cloud history route", () => {
  it("returns validated records from Supabase", async () => {
    const row = {
      id: record.id, version: 4, url: record.url, final_url: record.finalUrl, title: record.title,
      mode: record.mode, created_at: record.createdAt, status: record.status, scores: record.scores,
      page_count: null, details: null, report_available: true,
    };
    const chain = {
      select: vi.fn(), eq: vi.fn(), order: vi.fn(),
      limit: vi.fn().mockResolvedValue({ data: [row], error: null }),
    };
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.order.mockReturnValue(chain);
    mocks.from.mockReturnValue(chain);
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ records: [record] });
  });

  it("upserts a summary and its reopenable report", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({ upsert });
    const report = { version: 1, id: record.id, kind: "single", createdAt: record.createdAt, phase: "done", report: {}, error: null };
    const response = await PUT(request("PUT", { records: [record], report }));
    expect(response.status).toBe(200);
    expect(mocks.from).toHaveBeenCalledWith("audit_runs");
    expect(mocks.from).toHaveBeenCalledWith("audit_reports");
    expect(await response.json()).toEqual({ saved: 1, reportSaved: true });
  });

  it("loads a report only from the current owner workspace", async () => {
    const report = { version: 1, id: record.id, kind: "single", createdAt: record.createdAt, phase: "done", report: {}, error: null };
    const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { payload: report }, error: null }) };
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
    mocks.from.mockReturnValue(chain);
    const response = await POST(request("POST", { id: record.id }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ report });
    expect(chain.eq).toHaveBeenCalledWith("owner_hash", "owner-hash");
  });
});

