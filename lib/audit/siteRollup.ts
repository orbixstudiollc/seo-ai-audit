import { LENSES } from "@aeo/scoring";
import type { Lens, ScoreBreakdown } from "@aeo/scoring";
import type { AuditFindings, PageMeta, SiteRollup, WorstPage, CommonFinding } from "./types";

/**
 * One page's outcome as the bulk queue finishes with it — the input to the
 * site-level rollup. `status: "error"` covers everything from a fetch
 * failure to a per-page timeout; `scores`/`findings` are null whenever the
 * pipeline never reached the `scores` event for that page.
 */
export interface PageAuditResult {
  url: string;
  status: "ok" | "error";
  page: PageMeta | null;
  scores: ScoreBreakdown | null;
  findings: AuditFindings | null;
}

export type { SiteRollup, WorstPage, CommonFinding } from "./types";

const MAX_WORST_PAGES = 5;
const MAX_COMMON_FINDINGS = 5;
/** A "common" finding must recur on more than one page — a single page's own
 * issue belongs in its own report, not the site-level rollup. */
const MIN_COMMON_FINDING_COUNT = 2;

function overallScore(scores: ScoreBreakdown): number {
  const values = LENSES.map((lens) => scores.lenses[lens].score);
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/** Computes the site-level rollup DATA-CONTRACT's `site:rollup` event carries from every page's outcome so far. */
export function computeSiteRollup(results: readonly PageAuditResult[]): SiteRollup {
  const scored = results.filter(
    (r): r is PageAuditResult & { scores: ScoreBreakdown } => r.status === "ok" && r.scores !== null,
  );
  const pagesFailed = results.length - scored.length;

  const avgScores: Record<Lens, number> | null =
    scored.length === 0
      ? null
      : (Object.fromEntries(
          LENSES.map((lens) => [
            lens,
            Math.round(scored.reduce((sum, r) => sum + r.scores.lenses[lens].score, 0) / scored.length),
          ]),
        ) as Record<Lens, number>);

  const worstPages: WorstPage[] = [...scored]
    .map((r) => ({ url: r.url, title: r.page?.title || r.url, overallScore: overallScore(r.scores) }))
    .sort((a, b) => a.overallScore - b.overallScore)
    .slice(0, MAX_WORST_PAGES);

  const issueCounts = new Map<string, number>();
  for (const r of scored) {
    for (const blocker of r.findings?.blockers ?? []) {
      issueCounts.set(blocker.issue, (issueCounts.get(blocker.issue) ?? 0) + 1);
    }
  }
  const commonFindings: CommonFinding[] = [...issueCounts.entries()]
    .filter(([, count]) => count >= MIN_COMMON_FINDING_COUNT)
    .map(([issue, count]) => ({ issue, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_COMMON_FINDINGS);

  return { pagesAudited: scored.length, pagesFailed, avgScores, worstPages, commonFindings };
}
