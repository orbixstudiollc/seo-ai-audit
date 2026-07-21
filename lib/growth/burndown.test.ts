import { describe, expect, it } from "vitest";
import type { AuditHistoryRecord } from "@/lib/history";
import { actionPlanForSite, type ActionPlan } from "@/lib/skills/actionPlan";
import { diffActionPlans, domainIssueTrend, openIssueCount } from "./burndown";

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

function plan(ids: string[]): ActionPlan {
  return {
    generatedAt: "2026-07-01T00:00:00.000Z",
    items: ids.map((id) => ({
      id, severity: "medium", title: id, detail: id, source: id, urls: [], effort: "quick",
    })),
  };
}

describe("openIssueCount", () => {
  it("returns null when the record has no details yet", () => {
    expect(openIssueCount(record({ details: undefined }))).toBeNull();
  });

  it("counts weak signals + blockers + question gaps for single-page audits", () => {
    const count = openIssueCount(record({
      details: {
        kind: "single",
        weakestSignals: [{ id: "S1", score: 40 }],
        blockers: ["b1", "b2"],
        questionGaps: [],
        citationClaims: [],
        rewriteCount: 0,
      },
    }));
    expect(count).toBe(3);
  });

  it("counts common findings + worst pages + a failed-pages flag for site audits", () => {
    const count = openIssueCount(record({
      mode: "site",
      details: {
        kind: "site",
        pagesFailed: 2,
        worstPages: [{ url: "https://example.com/a", title: "A", overallScore: 30 }],
        commonFindings: [{ issue: "Missing schema", count: 5 }],
      },
    }));
    expect(count).toBe(3); // 1 finding + 1 worst page + 1 (pagesFailed > 0)
  });

  it("does not add the failed-pages flag when nothing failed", () => {
    const count = openIssueCount(record({
      mode: "site",
      details: { kind: "site", pagesFailed: 0, worstPages: [], commonFindings: [] },
    }));
    expect(count).toBe(0);
  });
});

describe("domainIssueTrend", () => {
  it("orders by createdAt ascending and drops records with no details", () => {
    const trend = domainIssueTrend([
      record({ createdAt: "2026-07-03T00:00:00.000Z", details: { kind: "single", weakestSignals: [], blockers: [], questionGaps: [], citationClaims: [], rewriteCount: 0 } }),
      record({ createdAt: "2026-07-01T00:00:00.000Z", details: { kind: "single", weakestSignals: [{ id: "S1", score: 10 }], blockers: [], questionGaps: [], citationClaims: [], rewriteCount: 0 } }),
      record({ createdAt: "2026-07-02T00:00:00.000Z", details: undefined, status: "started" }),
    ]);
    expect(trend).toEqual([1, 0]);
  });
});

describe("diffActionPlans", () => {
  it("returns null when either plan is unavailable", () => {
    expect(diffActionPlans(null, plan(["a"]))).toBeNull();
    expect(diffActionPlans(plan(["a"]), null)).toBeNull();
  });

  it("counts items present before but not now as resolved, and vice versa for introduced", () => {
    const result = diffActionPlans(plan(["a", "b", "c"]), plan(["b", "d"]));
    expect(result).toEqual({ resolved: 2, introduced: 1 }); // a,c resolved; d introduced
  });

  it("is zero/zero for an identical plan", () => {
    expect(diffActionPlans(plan(["a", "b"]), plan(["a", "b"]))).toEqual({ resolved: 0, introduced: 0 });
  });

  it("correctly attributes resolved/introduced through real actionPlanForSite output, not just hand-built ids", () => {
    // Regression for a real bug: item ids used to be positional (`common-0`),
    // and commonFindings is sorted by count — so "index 0" names a DIFFERENT
    // issue on every audit. A positional-id diff would see "common-0" in both
    // plans and count it as neither resolved nor introduced, even though the
    // underlying issue is completely unrelated.
    const previous = actionPlanForSite("https://example.com/", {
      pagesAudited: 3, pagesFailed: 0, avgScores: null,
      worstPages: [{ url: "https://example.com/a", title: "A", overallScore: 40 }],
      commonFindings: [{ issue: "Missing schema", count: 3 }],
    }, "2026-07-15T00:00:00.000Z");
    const current = actionPlanForSite("https://example.com/", {
      pagesAudited: 3, pagesFailed: 0, avgScores: null,
      worstPages: [],
      commonFindings: [{ issue: "Thin content", count: 2 }],
    }, "2026-07-19T00:00:00.000Z");

    const result = diffActionPlans(previous, current);
    // Resolved: "Missing schema" (gone) + "worst-pages" (worstPages now empty).
    // Introduced: "Thin content" (a genuinely new, unrelated issue).
    expect(result).toEqual({ resolved: 2, introduced: 1 });
  });
});
