import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DET_SIGNAL_IDS, SIGNALS_VERSION } from "@aeo/scoring";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  dueSites: vi.fn(),
  claimSite: vi.fn(),
  snapshotSite: vi.fn(),
  pruneOldSnapshots: vi.fn(),
}));

vi.mock("@/lib/cloud/server", () => ({
  cloudHistoryConfigured: () => true,
  resolveOwnerHashFromRequest: async () => "owner-hash",
  getSupabaseAdmin: () => ({ from: mocks.from }),
}));

vi.mock("@/lib/growth/collect", () => ({
  dueSites: mocks.dueSites,
  claimSite: mocks.claimSite,
  snapshotSite: mocks.snapshotSite,
  pruneOldSnapshots: mocks.pruneOldSnapshots,
}));

import { GET as cronGet } from "@/app/api/cron/snapshots/route";
import { GET as growthGet } from "@/app/api/growth/route";

type ChainResult = { data?: unknown; error?: unknown };

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

function cronRequest(authorization?: string): Request {
  return new Request("http://localhost/api/cron/snapshots", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  mocks.from.mockReset();
  mocks.dueSites.mockReset();
  mocks.claimSite.mockReset();
  mocks.snapshotSite.mockReset();
  mocks.pruneOldSnapshots.mockReset();
  mocks.pruneOldSnapshots.mockResolvedValue(0);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cron snapshots auth", () => {
  it("returns 503 when CRON_SECRET is unconfigured (deny-closed)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await cronGet(cronRequest("Bearer test-secret"));
    expect(response.status).toBe(503);
    expect(mocks.dueSites).not.toHaveBeenCalled();
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const response = await cronGet(cronRequest());
    expect(response.status).toBe(401);
    expect(mocks.dueSites).not.toHaveBeenCalled();
  });

  it("returns 401 on a wrong secret of the same length", async () => {
    const response = await cronGet(cronRequest("Bearer test-secreX"));
    expect(response.status).toBe(401);
    expect(mocks.dueSites).not.toHaveBeenCalled();
  });

  it("returns 401 on a wrong secret of a different length", async () => {
    const response = await cronGet(cronRequest("Bearer nope"));
    expect(response.status).toBe(401);
    expect(mocks.dueSites).not.toHaveBeenCalled();
  });
});

describe("cron snapshots run", () => {
  it("claims sequentially, skips lost CAS races, and reports counts", async () => {
    const sites = [
      { ownerHash: "o", url: "https://a.com/", lastRunAt: null },
      { ownerHash: "o", url: "https://b.com/", lastRunAt: "2026-07-19T03:00:00.000Z" },
      { ownerHash: "o", url: "https://c.com/", lastRunAt: null },
    ];
    mocks.dueSites.mockResolvedValue(sites);
    mocks.claimSite.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mocks.snapshotSite.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error("db down"));
    mocks.pruneOldSnapshots.mockResolvedValue(2);

    const response = await cronGet(cronRequest("Bearer test-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ scanned: 3, captured: 1, failed: 1, pruned: 2 });
    expect(mocks.snapshotSite).toHaveBeenCalledTimes(2);
    expect(mocks.claimSite).toHaveBeenNthCalledWith(2, expect.anything(), sites[1], sites[1].lastRunAt);
  });

  it("returns 503 when the due-site read fails", async () => {
    mocks.dueSites.mockRejectedValue(new Error("tracked_sites_read_failed"));
    const response = await cronGet(cronRequest("Bearer test-secret"));
    expect(response.status).toBe(503);
  });
});

describe("growth series route", () => {
  const detScores = Object.fromEntries(DET_SIGNAL_IDS.map((id) => [id, 60]));

  function growthRequest(query: string): Request {
    return new Request(`http://localhost/api/growth${query}`);
  }

  it("rejects days over the 90-day cap", async () => {
    const response = await growthGet(growthRequest("?url=https%3A%2F%2Fexample.com%2F&days=200"));
    expect(response.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects a missing or invalid url", async () => {
    expect((await growthGet(growthRequest(""))).status).toBe(400);
    expect((await growthGet(growthRequest("?url=not-a-url"))).status).toBe(400);
  });

  it("defaults to 30 days and caps the query limit at the requested days", async () => {
    const snapshots = chain({ data: [], error: null });
    mocks.from.mockReturnValue(snapshots);
    await growthGet(growthRequest("?url=https%3A%2F%2Fexample.com%2F"));
    expect(snapshots.limit).toHaveBeenCalledWith(30);
    await growthGet(growthRequest("?url=https%3A%2F%2Fexample.com%2F&days=7"));
    expect(snapshots.limit).toHaveBeenCalledWith(7);
  });

  it("returns oldest-first snapshots with changed/err flags and a score-only det map", async () => {
    const snapshots = chain({
      data: [
        {
          captured_on: "2026-07-20",
          det_scores: { ...detScores, S99: 999 },
          lens_estimate: { aeo: 61, geo: 62, citability: 63, aiOverview: 64 },
          signals_version: "det-v9",
          fetch_meta: { changed: true },
        },
        {
          captured_on: "2026-07-19",
          det_scores: null,
          lens_estimate: null,
          signals_version: "det-v8",
          fetch_meta: { error: "timeout" },
        },
        {
          captured_on: "2026-07-18",
          det_scores: detScores,
          lens_estimate: null,
          signals_version: "det-v8",
          fetch_meta: {},
        },
      ],
      error: null,
    });
    mocks.from.mockReturnValue(snapshots);

    const response = await growthGet(growthRequest("?url=https%3A%2F%2Fexample.com%2F&days=3"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toBe("https://example.com/");
    expect(body.signalsVersion).toBe("det-v9");
    expect(body.series.map((s: { d: string }) => s.d)).toEqual(["2026-07-18", "2026-07-19", "2026-07-20"]);
    expect(body.series[0]).toEqual({ d: "2026-07-18", det: detScores, lens: null });
    expect(body.series[1]).toEqual({ d: "2026-07-19", det: null, lens: null, err: true });
    expect(body.series[2].changed).toBe(true);
    // Wire det map is rebuilt score-only from the DET id list — no stray keys.
    expect(Object.keys(body.series[2].det).sort()).toEqual([...DET_SIGNAL_IDS].sort());
  });

  it("returns an empty series with the current engine stamp when nothing is captured", async () => {
    const snapshots = chain({ data: [], error: null });
    mocks.from.mockReturnValue(snapshots);
    const response = await growthGet(growthRequest("?url=https%3A%2F%2Fexample.com%2F"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://example.com/", signalsVersion: SIGNALS_VERSION, series: [] });
  });
});
