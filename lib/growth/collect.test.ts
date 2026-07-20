import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DET_SIGNAL_IDS, LENSES, RUB_SIGNAL_IDS, SIGNALS_VERSION } from "@aeo/scoring";
import { ImportError } from "@/lib/import/errors";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  fetchArticle: vi.fn(),
}));

vi.mock("@/lib/import/fetchArticle", () => ({
  fetchArticle: mocks.fetchArticle,
}));

import { claimSite, dueSites, pruneOldSnapshots, snapshotSite } from "./collect";

type ChainResult = { data?: unknown; error?: unknown; count?: number | null };

/**
 * Thenable supabase chain stand-in (technical-audit.test.ts pattern, extended):
 * every builder method chains, and awaiting the chain — or maybeSingle/single —
 * resolves the configured result.
 */
function chain(result: ChainResult) {
  const value: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (onFulfilled: (v: ChainResult) => unknown) => Promise<unknown>;
  } = {} as never;
  for (const method of ["select", "eq", "or", "order", "limit", "lt", "not", "is", "insert", "update", "delete", "upsert"]) {
    value[method] = vi.fn(() => value);
  }
  value.maybeSingle = vi.fn(async () => result);
  value.single = vi.fn(async () => result);
  value.then = (onFulfilled) => Promise.resolve(result).then(onFulfilled);
  return value;
}

function db(route: (table: string) => ReturnType<typeof chain>): SupabaseClient {
  mocks.from.mockImplementation(route);
  return { from: mocks.from } as unknown as SupabaseClient;
}

const HTML =
  "<html><head><title>Hello</title></head><body><h1>Hello</h1><p>Some steady content that answers a question directly.</p></body></html>";

const rubSignals = Object.fromEntries(
  RUB_SIGNAL_IDS.map((id) => [id, { id, score: 60, evidence: "quoted" }]),
);

beforeEach(() => {
  mocks.from.mockReset();
  mocks.fetchArticle.mockReset();
});

describe("dueSites", () => {
  it("maps rows and bounds the query to the UTC day start", async () => {
    const tracked = chain({ data: [{ owner_hash: "o", url: "https://a.com/", last_run_at: null }], error: null });
    const sites = await dueSites(db(() => tracked), new Date("2026-07-20T15:00:00.000Z"), 25);
    expect(sites).toEqual([{ ownerHash: "o", url: "https://a.com/", lastRunAt: null }]);
    expect(tracked.or).toHaveBeenCalledWith("last_run_at.is.null,last_run_at.lt.2026-07-20T00:00:00.000Z");
    expect(tracked.order).toHaveBeenCalledWith("last_run_at", { ascending: true, nullsFirst: true });
    expect(tracked.limit).toHaveBeenCalledWith(25);
  });

  it("throws when the read fails so the cron can 503", async () => {
    const tracked = chain({ data: null, error: { message: "down" } });
    await expect(dueSites(db(() => tracked), new Date(), 25)).rejects.toThrow("tracked_sites_read_failed");
  });
});

describe("claimSite", () => {
  const site = { ownerHash: "o", url: "https://a.com/", lastRunAt: null };

  it("returns false when the CAS update matched zero rows", async () => {
    const tracked = chain({ data: [], error: null });
    expect(await claimSite(db(() => tracked), site, null)).toBe(false);
    expect(tracked.is).toHaveBeenCalledWith("last_run_at", null);
  });

  it("returns true when exactly this observed last_run_at was advanced", async () => {
    const tracked = chain({ data: [{ url: site.url }], error: null });
    expect(await claimSite(db(() => tracked), site, "2026-07-19T03:00:00.000Z")).toBe(true);
    expect(tracked.eq).toHaveBeenCalledWith("last_run_at", "2026-07-19T03:00:00.000Z");
  });
});

describe("snapshotSite", () => {
  const now = new Date("2026-07-20T03:00:00.000Z");

  function successDb(options: { prevHash?: string | null; payload?: unknown } = {}) {
    const snapshots = chain({ data: options.prevHash === undefined ? null : { content_hash: options.prevHash }, error: null });
    const runs = chain({ data: options.payload === undefined ? null : { id: "audit-1" }, error: null });
    const reports = chain({ data: options.payload === undefined ? null : { payload: options.payload }, error: null });
    const client = db((table) => (table === "audit_runs" ? runs : table === "audit_reports" ? reports : snapshots));
    return { client, snapshots, runs, reports };
  }

  it("upserts an error row with a kind-only string when the fetch fails", async () => {
    mocks.fetchArticle.mockRejectedValue(new ImportError("timeout", "secret page details"));
    const snapshots = chain({ data: null, error: null });
    const result = await snapshotSite(db(() => snapshots), "o", "https://a.com/", now);
    expect(result.ok).toBe(false);
    expect(snapshots.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        owner_hash: "o",
        url: "https://a.com/",
        captured_on: "2026-07-20",
        det_scores: null,
        lens_estimate: null,
        content_hash: null,
        fetch_meta: { error: "timeout" },
      }),
      { onConflict: "owner_hash,url,captured_on" },
    );
  });

  it("stores a score-only DET map, a content hash, and null lens before the first audit", async () => {
    mocks.fetchArticle.mockResolvedValue({ title: "Hello", html: HTML, finalUrl: "https://a.com/" });
    const { client, snapshots } = successDb();
    const result = await snapshotSite(client, "o", "https://a.com/", now);
    expect(result.ok).toBe(true);
    const upserted = snapshots.upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(upserted.det_scores as Record<string, number>).sort()).toEqual([...DET_SIGNAL_IDS].sort());
    for (const value of Object.values(upserted.det_scores as Record<string, number>)) {
      expect(typeof value).toBe("number");
    }
    expect(upserted.lens_estimate).toBeNull();
    expect(upserted.signals_version).toBe(SIGNALS_VERSION);
    expect(typeof upserted.content_hash).toBe("string");
    expect(upserted.fetch_meta).toEqual({});
  });

  it("flags changed when the previous snapshot's hash differs, and not when it matches", async () => {
    mocks.fetchArticle.mockResolvedValue({ title: "Hello", html: HTML, finalUrl: "https://a.com/" });
    const first = successDb({ prevHash: "0".repeat(64) });
    await snapshotSite(first.client, "o", "https://a.com/", now);
    const changedRow = first.snapshots.upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(changedRow.fetch_meta).toEqual({ changed: true });

    const second = successDb({ prevHash: changedRow.content_hash as string });
    await snapshotSite(second.client, "o", "https://a.com/", now);
    const unchangedRow = second.snapshots.upsert.mock.calls[0][0] as Record<string, unknown>;
    expect(unchangedRow.fetch_meta).toEqual({});
  });

  it("blends a lens estimate only when the latest report carries full RUB signals", async () => {
    mocks.fetchArticle.mockResolvedValue({ title: "Hello", html: HTML, finalUrl: "https://a.com/" });
    const withRub = successDb({
      prevHash: null,
      payload: { kind: "single", report: { scores: { signals: rubSignals } } },
    });
    await snapshotSite(withRub.client, "o", "https://a.com/", now);
    const row = withRub.snapshots.upsert.mock.calls[0][0] as { lens_estimate: Record<string, number> };
    expect(Object.keys(row.lens_estimate).sort()).toEqual([...LENSES].sort());
    for (const lens of LENSES) expect(typeof row.lens_estimate[lens]).toBe("number");
  });

  it("keeps lens null when the report is missing a RUB signal", async () => {
    mocks.fetchArticle.mockResolvedValue({ title: "Hello", html: HTML, finalUrl: "https://a.com/" });
    const partial = Object.fromEntries(Object.entries(rubSignals).filter(([id]) => id !== "S12"));
    const withPartial = successDb({
      prevHash: null,
      payload: { kind: "single", report: { scores: { signals: partial } } },
    });
    await snapshotSite(withPartial.client, "o", "https://a.com/", now);
    const row = withPartial.snapshots.upsert.mock.calls[0][0] as { lens_estimate: unknown };
    expect(row.lens_estimate).toBeNull();
  });
});

describe("pruneOldSnapshots", () => {
  it("deletes snapshots past the cutoff and reports the count", async () => {
    const snapshots = chain({ count: 3, error: null });
    const pruned = await pruneOldSnapshots(db(() => snapshots), new Date("2026-07-20T03:00:00.000Z"));
    expect(pruned).toBe(3);
    expect(snapshots.delete).toHaveBeenCalledWith({ count: "exact" });
    expect(snapshots.lt).toHaveBeenCalledWith("captured_on", "2025-06-15");
  });

  it("reports zero when the delete errors", async () => {
    const snapshots = chain({ count: null, error: { message: "down" } });
    expect(await pruneOldSnapshots(db(() => snapshots), new Date())).toBe(0);
  });
});
