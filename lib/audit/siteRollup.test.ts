import { describe, expect, it } from "vitest";
import type { ScoreBreakdown } from "@aeo/scoring";
import { computeSiteRollup, type PageAuditResult } from "./siteRollup";
import type { AuditFindings, PageMeta } from "./types";

function fakeScores(lensScores: { aeo: number; geo: number; citability: number; aiOverview: number }): ScoreBreakdown {
  return {
    lenses: {
      aeo: { lens: "aeo", score: lensScores.aeo, capped: false },
      geo: { lens: "geo", score: lensScores.geo, capped: false },
      citability: { lens: "citability", score: lensScores.citability, capped: false },
      aiOverview: { lens: "aiOverview", score: lensScores.aiOverview, capped: false },
    },
    signals: {},
    rubricVersion: "test",
    signalsVersion: "test",
    modelId: "test",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function fakePage(title: string): PageMeta {
  return { url: "", finalUrl: "", title, wordCount: 100, fetchedAt: "" };
}

function fakeFindings(blockerIssues: string[]): AuditFindings {
  return {
    questionGaps: [],
    anchorSuggestions: [],
    blockers: blockerIssues.map((issue) => ({ issue, location: "" })),
    qaPairs: [],
    quotables: [],
  };
}

describe("computeSiteRollup", () => {
  it("returns null avgScores and zero counts for an empty result set", () => {
    const rollup = computeSiteRollup([]);
    expect(rollup).toEqual({ pagesAudited: 0, pagesFailed: 0, avgScores: null, worstPages: [], commonFindings: [] });
  });

  it("counts failed pages separately from scored ones", () => {
    const results: PageAuditResult[] = [
      { url: "https://x/a", status: "ok", page: fakePage("A"), scores: fakeScores({ aeo: 80, geo: 80, citability: 80, aiOverview: 80 }), findings: null },
      { url: "https://x/b", status: "error", page: null, scores: null, findings: null },
    ];
    const rollup = computeSiteRollup(results);
    expect(rollup.pagesAudited).toBe(1);
    expect(rollup.pagesFailed).toBe(1);
  });

  it("averages each lens across scored pages only", () => {
    const results: PageAuditResult[] = [
      { url: "https://x/a", status: "ok", page: fakePage("A"), scores: fakeScores({ aeo: 60, geo: 40, citability: 80, aiOverview: 100 }), findings: null },
      { url: "https://x/b", status: "ok", page: fakePage("B"), scores: fakeScores({ aeo: 80, geo: 60, citability: 100, aiOverview: 80 }), findings: null },
      { url: "https://x/c", status: "error", page: null, scores: null, findings: null },
    ];
    const rollup = computeSiteRollup(results);
    expect(rollup.avgScores).toEqual({ aeo: 70, geo: 50, citability: 90, aiOverview: 90 });
  });

  it("ranks worstPages ascending by overall (mean-lens) score, capped at 5", () => {
    const results: PageAuditResult[] = Array.from({ length: 7 }, (_, i) => ({
      url: `https://x/p${i}`,
      status: "ok" as const,
      page: fakePage(`Page ${i}`),
      scores: fakeScores({ aeo: 100 - i * 10, geo: 100 - i * 10, citability: 100 - i * 10, aiOverview: 100 - i * 10 }),
      findings: null,
    }));
    const rollup = computeSiteRollup(results);
    expect(rollup.worstPages).toHaveLength(5);
    expect(rollup.worstPages[0].url).toBe("https://x/p6"); // lowest score first
    expect(rollup.worstPages[0].overallScore).toBe(40);
    expect(rollup.worstPages.at(-1)?.url).toBe("https://x/p2");
  });

  it("surfaces blockers that recur on 2+ pages, sorted by frequency, excludes one-offs", () => {
    const results: PageAuditResult[] = [
      { url: "https://x/a", status: "ok", page: fakePage("A"), scores: fakeScores({ aeo: 50, geo: 50, citability: 50, aiOverview: 50 }), findings: fakeFindings(["No answer-first intro", "Missing schema"]) },
      { url: "https://x/b", status: "ok", page: fakePage("B"), scores: fakeScores({ aeo: 50, geo: 50, citability: 50, aiOverview: 50 }), findings: fakeFindings(["No answer-first intro"]) },
      { url: "https://x/c", status: "ok", page: fakePage("C"), scores: fakeScores({ aeo: 50, geo: 50, citability: 50, aiOverview: 50 }), findings: fakeFindings(["No answer-first intro", "Thin content"]) },
    ];
    const rollup = computeSiteRollup(results);
    expect(rollup.commonFindings).toEqual([{ issue: "No answer-first intro", count: 3 }]);
    // "Missing schema" and "Thin content" each occur once — not "common".
  });

  it("falls back to the URL as a worst-page label when page.title is empty", () => {
    const results: PageAuditResult[] = [
      { url: "https://x/untitled", status: "ok", page: fakePage(""), scores: fakeScores({ aeo: 30, geo: 30, citability: 30, aiOverview: 30 }), findings: null },
    ];
    const rollup = computeSiteRollup(results);
    expect(rollup.worstPages[0].title).toBe("https://x/untitled");
  });
});
