import { describe, expect, it } from "vitest";
import { DET_SIGNAL_IDS, RUB_SIGNAL_IDS, LENSES } from "@aeo/scoring";
import { mockReport } from "@/lib/audit/mockReport";
import { buildFindingItems } from "@/lib/audit/derive";
import { eeatFrom, primaryLensFor } from "@/app/components/audit/AuditReportView";
import { formatFetchedAt } from "@/app/components/audit/ReportHeader";

/**
 * There's no jsdom/testing-library in this repo (vitest runs in the "node"
 * environment — see vitest.config.ts), so — following the existing
 * `exportMenu.test.ts` pattern — this pins the DATA-CONTRACT field coverage
 * and the field -> component mapping logic (which lens a finding jumps to,
 * where the E-E-A-T strip's result comes from, how the header formats a
 * timestamp) rather than rendering JSX.
 *
 * Field -> component checklist (docs/phases/ws3-report.md mirrors this):
 *   page            -> ReportHeader
 *   scores.lenses   -> ScoreRail (4 ScoreTiles) + SignalBreakdown on open
 *   scores.signals  -> SignalBreakdown (per-lens contributors) + EeatStrip (S17)
 *   findings.*      -> FindingsPanel (blockers/gaps/weak via FindingsDrawer,
 *                      anchorSuggestions/quotables/qaPairs as their own sections)
 *   rewrites.hunks  -> RewritesPanel (read-only DiffHunk)
 */

describe("mockReport field coverage", () => {
  it("has every DET and RUB signal id", () => {
    for (const id of [...DET_SIGNAL_IDS, ...RUB_SIGNAL_IDS]) {
      expect(mockReport.scores.signals[id]).toBeDefined();
    }
  });

  it("has every lens", () => {
    for (const lens of LENSES) {
      expect(mockReport.scores.lenses[lens]).toBeDefined();
    }
  });

  it("has a non-empty array for every AuditFindings field", () => {
    expect(mockReport.findings.questionGaps.length).toBeGreaterThan(0);
    expect(mockReport.findings.anchorSuggestions.length).toBeGreaterThan(0);
    expect(mockReport.findings.blockers.length).toBeGreaterThan(0);
    expect(mockReport.findings.qaPairs.length).toBeGreaterThan(0);
    expect(mockReport.findings.quotables.length).toBeGreaterThan(0);
  });

  it("has 2-3 rewrite hunks, each labeled with a target signal", () => {
    expect(mockReport.rewrites?.hunks.length).toBeGreaterThanOrEqual(2);
    expect(mockReport.rewrites?.hunks.length).toBeLessThanOrEqual(3);
    for (const hunk of mockReport.rewrites?.hunks ?? []) {
      expect(hunk.targetSignal).toBeDefined();
    }
  });

  it("findings arrays stay within the contract's 10-item bound", () => {
    expect(mockReport.findings.questionGaps.length).toBeLessThanOrEqual(10);
    expect(mockReport.findings.anchorSuggestions.length).toBeLessThanOrEqual(10);
    expect(mockReport.findings.blockers.length).toBeLessThanOrEqual(10);
    expect(mockReport.findings.qaPairs.length).toBeLessThanOrEqual(10);
    expect(mockReport.findings.quotables.length).toBeLessThanOrEqual(10);
  });
});

describe("buildFindingItems(mockReport) — feeds FindingsPanel's severity-chipped list", () => {
  it("includes every blocker and question gap, plus weak-signal items for low scorers", () => {
    const items = buildFindingItems(mockReport.scores, mockReport.findings);
    const blockerItems = items.filter((i) => i.severity === "blocker");
    const gapItems = items.filter((i) => i.severity === "gap");
    const weakItems = items.filter((i) => i.severity === "weak");

    expect(blockerItems).toHaveLength(mockReport.findings.blockers.length);
    expect(gapItems).toHaveLength(mockReport.findings.questionGaps.length);
    expect(weakItems.length).toBeGreaterThan(0);
  });
});

describe("eeatFrom — feeds EeatStrip", () => {
  it("pulls S17 off the breakdown", () => {
    expect(eeatFrom(mockReport.scores)).toEqual(mockReport.scores.signals.S17);
  });

  it("is null with no breakdown yet (streaming state)", () => {
    expect(eeatFrom(null)).toBeNull();
  });
});

describe("primaryLensFor — jumps a finding to its heaviest-weighted lens", () => {
  it("routes the intro signal (S1) to the lens that weighs it heaviest (AI Overview, weight 25 vs AEO's 10)", () => {
    expect(primaryLensFor("S1")).toBe("aiOverview");
  });

  it("defaults to the first lens when a finding carries no signal id", () => {
    expect(primaryLensFor(undefined)).toBe(LENSES[0]);
  });
});

describe("formatFetchedAt — feeds the ReportHeader caption", () => {
  it("formats the mock report's fetchedAt into a readable date", () => {
    const formatted = formatFetchedAt(mockReport.page.fetchedAt);
    expect(formatted).not.toBe(mockReport.page.fetchedAt);
    expect(formatted.length).toBeGreaterThan(0);
  });

  it("falls back to the raw string for an unparseable timestamp", () => {
    expect(formatFetchedAt("not-a-date")).toBe("not-a-date");
  });
});
