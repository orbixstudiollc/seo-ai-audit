import { describe, expect, it } from "vitest";
import { LEGACY_HISTORY_KEY, LEGACY_HISTORY_V2_KEY, LEGACY_HISTORY_V1_KEY, addHistoryRecord, averageScore, filterAndSortHistory, isHistoryRecord, loadHistory, type AuditHistoryRecord } from "./index";

function record(overrides: Partial<AuditHistoryRecord> = {}): AuditHistoryRecord {
  return { id: "1", version: 4, url: "https://example.com/post", title: "Example post", mode: "single", createdAt: "2026-07-19T10:00:00.000Z", status: "complete", scores: { aeo: 80, geo: 70, citability: 60, aiOverview: 50 }, ...overrides };
}

describe("local audit history", () => {
  it("accepts every query lifecycle and rejects future records", () => { for (const status of ["started", "complete", "partial", "failed"] as const) expect(isHistoryRecord(record({ status, scores: status === "started" || status === "failed" ? null : record().scores }))).toBe(true); expect(isHistoryRecord({ ...record(), version: 5 })).toBe(false); });
  it("recovers from corrupt storage", () => { expect(loadHistory({ getItem: () => "not json" })).toEqual([]); });
  it("filters invalid stored entries", () => { expect(loadHistory({ getItem: () => JSON.stringify([record(), { broken: true }]) })).toEqual([record()]); });
  it("migrates existing v3 history when v4 is absent", () => { const legacy = { ...record(), version: 3 }; const storage = { getItem: (key: string) => key === LEGACY_HISTORY_KEY ? JSON.stringify([legacy]) : null }; expect(loadHistory(storage)).toEqual([record()]); });
  it("migrates existing v2 history when newer keys are absent", () => { const legacy = { ...record(), version: 2 }; const storage = { getItem: (key: string) => key === LEGACY_HISTORY_V2_KEY ? JSON.stringify([legacy]) : null }; expect(loadHistory(storage)).toEqual([record()]); });
  it("migrates existing v1 history when newer keys are absent", () => { const legacy = { ...record(), version: 1 }; const storage = { getItem: (key: string) => key === LEGACY_HISTORY_V1_KEY ? JSON.stringify([legacy]) : null }; expect(loadHistory(storage)).toEqual([record()]); });
  it("validates bounded compact details", () => { const withDetails = record({ details: { kind: "single", wordCount: 800, weakestSignals: [{ id: "S1", score: 20 }], blockers: ["Answer buried"], questionGaps: ["How long?"], citationClaims: ["A claim"], rewriteCount: 3 } }); expect(isHistoryRecord(withDetails)).toBe(true); expect(isHistoryRecord({ ...withDetails, details: { ...withDetails.details, blockers: Array(6).fill("Too many") } })).toBe(false); });
  it("deduplicates by id and enforces the limit", () => { const items = Array.from({ length: 12 }, (_, i) => record({ id: String(i), createdAt: `2026-07-19T10:${String(i).padStart(2, "0")}:00.000Z` })); const next = addHistoryRecord(items, record({ id: "5", title: "Updated", createdAt: "2026-07-20T10:00:00.000Z" }), 10); expect(next).toHaveLength(10); expect(next.filter((item) => item.id === "5")).toHaveLength(1); });
  it("searches, filters and sorts", () => { const site = record({ id: "2", mode: "site", title: "Docs", url: "https://docs.example.com", createdAt: "2026-07-20T10:00:00.000Z", scores: { aeo: 90, geo: 90, citability: 90, aiOverview: 90 } }); expect(filterAndSortHistory([record(), site], { query: "docs", mode: "site" })).toEqual([site]); expect(filterAndSortHistory([record(), site], { sort: "highest" })[0]).toEqual(site); expect(averageScore(record())).toBe(65); });
});
