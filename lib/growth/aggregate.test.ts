import { describe, expect, it } from "vitest";
import type { AuditHistoryRecord } from "@/lib/history";
import { domainOf, groupByDomain, needsAttention, summarize } from "./aggregate";

function record(overrides: Partial<AuditHistoryRecord>): AuditHistoryRecord {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    version: 4,
    url: "https://example.com/page",
    title: "Example",
    mode: "single",
    createdAt: "2026-07-01T00:00:00.000Z",
    status: "complete",
    scores: { aeo: 60, geo: 60, citability: 60, aiOverview: 60 },
    ...overrides,
  } as AuditHistoryRecord;
}

const scores = (value: number) =>
  ({ aeo: value, geo: value, citability: value, aiOverview: value }) as AuditHistoryRecord["scores"];

describe("domainOf", () => {
  it("extracts the hostname and strips www", () => {
    expect(domainOf("https://www.example.com/a/b")).toBe("example.com");
  });
  it("falls back to the raw string for unparseable urls", () => {
    expect(domainOf("not a url")).toBe("not a url");
  });
});

describe("groupByDomain", () => {
  it("groups records by domain with newest activity first", () => {
    const groups = groupByDomain([
      record({ url: "https://a.com/1", createdAt: "2026-07-01T00:00:00.000Z" }),
      record({ url: "https://b.com/1", createdAt: "2026-07-03T00:00:00.000Z" }),
      record({ url: "https://www.a.com/2", createdAt: "2026-07-02T00:00:00.000Z" }),
    ]);
    expect(groups.map((group) => group.domain)).toEqual(["b.com", "a.com"]);
    expect(groups[1].auditCount).toBe(2);
    expect(groups[1].lastAuditedAt).toBe("2026-07-02T00:00:00.000Z");
  });

  it("builds a chronological series from scored records only", () => {
    const [group] = groupByDomain([
      record({ url: "https://a.com", createdAt: "2026-07-03T00:00:00.000Z", scores: scores(80) }),
      record({ url: "https://a.com", createdAt: "2026-07-01T00:00:00.000Z", scores: scores(50) }),
      record({ url: "https://a.com", createdAt: "2026-07-02T00:00:00.000Z", scores: null, status: "failed" }),
    ]);
    expect(group.series).toEqual([50, 80]);
    expect(group.delta).toBe(30);
    expect(group.latestScores).toEqual(scores(80));
  });

  it("reports null delta with fewer than two scored audits", () => {
    const [group] = groupByDomain([record({ url: "https://a.com" })]);
    expect(group.delta).toBeNull();
    expect(group.series).toEqual([60]);
  });
});

describe("needsAttention", () => {
  it("keeps dropping domains and failed-latest domains, worst drop first", () => {
    const groups = groupByDomain([
      // fine.com: improving
      record({ url: "https://fine.com", createdAt: "2026-07-01T00:00:00.000Z", scores: scores(50) }),
      record({ url: "https://fine.com", createdAt: "2026-07-02T00:00:00.000Z", scores: scores(70) }),
      // slip.com: small drop
      record({ url: "https://slip.com", createdAt: "2026-07-01T00:00:00.000Z", scores: scores(70) }),
      record({ url: "https://slip.com", createdAt: "2026-07-02T00:00:00.000Z", scores: scores(65) }),
      // crash.com: big drop
      record({ url: "https://crash.com", createdAt: "2026-07-01T00:00:00.000Z", scores: scores(80) }),
      record({ url: "https://crash.com", createdAt: "2026-07-02T00:00:00.000Z", scores: scores(40) }),
      // broke.com: latest failed, no delta
      record({ url: "https://broke.com", createdAt: "2026-07-02T00:00:00.000Z", scores: null, status: "failed" }),
    ]);
    expect(needsAttention(groups).map((group) => group.domain)).toEqual([
      "crash.com",
      "slip.com",
      "broke.com",
    ]);
  });
});

describe("summarize", () => {
  it("counts domains and audits and averages latest scores", () => {
    const groups = groupByDomain([
      record({ url: "https://a.com", scores: scores(80) }),
      record({ url: "https://b.com", scores: scores(40) }),
      record({ url: "https://b.com", createdAt: "2026-06-01T00:00:00.000Z", scores: scores(90) }),
    ]);
    const summary = summarize(groups);
    expect(summary.domainCount).toBe(2);
    expect(summary.auditCount).toBe(3);
    expect(summary.averageLatestScore).toBe(60);
    expect(summary.lastActivityAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("handles an empty workspace", () => {
    expect(summarize([])).toEqual({
      domainCount: 0,
      auditCount: 0,
      averageLatestScore: null,
      lastActivityAt: null,
    });
  });
});
