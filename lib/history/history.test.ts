import { describe, expect, it } from "vitest";
import { addHistoryRecord, averageScore, filterAndSortHistory, isHistoryRecord, loadHistory, type AuditHistoryRecord } from "./index";

function record(overrides: Partial<AuditHistoryRecord> = {}): AuditHistoryRecord {
  return { id: "1", version: 1, url: "https://example.com/post", title: "Example post", mode: "single", createdAt: "2026-07-19T10:00:00.000Z", status: "complete", scores: { aeo: 80, geo: 70, citability: 60, aiOverview: 50 }, ...overrides };
}

describe("local audit history", () => {
  it("rejects invalid and future records", () => { expect(isHistoryRecord(record())).toBe(true); expect(isHistoryRecord({ ...record(), version: 2 })).toBe(false); });
  it("recovers from corrupt storage", () => { expect(loadHistory({ getItem: () => "not json" })).toEqual([]); });
  it("filters invalid stored entries", () => { expect(loadHistory({ getItem: () => JSON.stringify([record(), { broken: true }]) })).toEqual([record()]); });
  it("deduplicates by id and enforces the limit", () => { const items = Array.from({ length: 12 }, (_, i) => record({ id: String(i), createdAt: `2026-07-19T10:${String(i).padStart(2, "0")}:00.000Z` })); const next = addHistoryRecord(items, record({ id: "5", title: "Updated", createdAt: "2026-07-20T10:00:00.000Z" }), 10); expect(next).toHaveLength(10); expect(next.filter((item) => item.id === "5")).toHaveLength(1); });
  it("searches, filters and sorts", () => { const site = record({ id: "2", mode: "site", title: "Docs", url: "https://docs.example.com", createdAt: "2026-07-20T10:00:00.000Z", scores: { aeo: 90, geo: 90, citability: 90, aiOverview: 90 } }); expect(filterAndSortHistory([record(), site], { query: "docs", mode: "site" })).toEqual([site]); expect(filterAndSortHistory([record(), site], { sort: "highest" })[0]).toEqual(site); expect(averageScore(record())).toBe(65); });
});
