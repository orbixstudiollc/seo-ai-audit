import { LENSES, type Lens, type ScoreBreakdown } from "@aeo/scoring";
import type { AuditFindings, AuditReport, SiteRollup } from "@/lib/audit/types";
import { computeRoadmap, type RoadmapBucket } from "@/lib/audit/derive";
import { LENS_META, SIGNAL_META } from "@/lib/audit/signalMeta";

/**
 * W5-ACTION-PLAN — a pure-TS synthesizer (DATA-CONTRACT §10). It maps data the
 * product already computes — AI-Overview blockers, question gaps, hard-capped
 * lenses, weak signals, whole-site recurring findings / worst pages, and (when
 * present) DataForSEO technical issue keys — into one severity-ranked,
 * effort-tagged action plan. No new providers, no LLM calls: every item is a
 * deterministic projection of existing audit output, so the same input always
 * yields the same plan.
 */

export type ActionSeverity = "critical" | "high" | "medium" | "low";
export type ActionEffort = "quick" | "moderate" | "project";

export interface ActionItem {
  id: string;
  severity: ActionSeverity;
  title: string;
  detail: string;
  /** Provenance: a signal id (S1–S18), a lens cap (`cap:aeo`), a site
   * aggregate (`site:worst`), or a technical issue key (`issue:<key>`). */
  source: string;
  /** Affected URLs, de-duplicated and bounded to ≤ 20 (DATA-CONTRACT §10). */
  urls: string[];
  effort: ActionEffort;
}

export interface ActionPlan {
  items: ActionItem[];
  generatedAt: string;
}

/** Max items a plan carries (DATA-CONTRACT §10). */
export const MAX_ACTION_ITEMS = 50;
/** Max URLs any single item lists (DATA-CONTRACT §10). */
export const MAX_ACTION_URLS = 20;

const SEVERITY_RANK: Record<ActionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Signals scoring below this are surfaced as their own weak-signal actions. */
const WEAK_SIGNAL_CEIL = 70;

/** Roadmap bucket → the plan's coarser effort tier. */
const EFFORT_BY_BUCKET: Record<RoadmapBucket, ActionEffort> = {
  quick: "quick",
  strategic: "moderate",
  long: "project",
};

/**
 * Known DataForSEO on-page issue keys, mapped to a severity and effort. Keys
 * not in this table fall back to `medium` / `moderate` — unknown ≠ ignored.
 */
const TECHNICAL_ISSUE_META: Record<string, { severity: ActionSeverity; effort: ActionEffort; label: string }> = {
  is_4xx_code: { severity: "critical", effort: "moderate", label: "Pages returning 4xx errors" },
  is_5xx_code: { severity: "critical", effort: "moderate", label: "Pages returning 5xx errors" },
  is_broken: { severity: "critical", effort: "moderate", label: "Broken pages" },
  broken_links: { severity: "high", effort: "moderate", label: "Pages with broken links" },
  broken_resources: { severity: "high", effort: "moderate", label: "Pages with broken resources" },
  canonical_to_broken: { severity: "high", effort: "moderate", label: "Canonical points to a broken URL" },
  redirect_loop: { severity: "high", effort: "moderate", label: "Redirect loops" },
  no_title: { severity: "high", effort: "quick", label: "Missing <title>" },
  no_description: { severity: "medium", effort: "quick", label: "Missing meta description" },
  no_h1_tag: { severity: "high", effort: "quick", label: "Missing H1" },
  duplicate_title_tag: { severity: "high", effort: "quick", label: "Duplicate titles" },
  duplicate_meta_tags: { severity: "medium", effort: "quick", label: "Duplicate meta descriptions" },
  duplicate_content: { severity: "high", effort: "project", label: "Duplicate content" },
  title_too_long: { severity: "low", effort: "quick", label: "Overly long titles" },
  title_too_short: { severity: "low", effort: "quick", label: "Overly short titles" },
  low_content_rate: { severity: "medium", effort: "project", label: "Thin content" },
  high_loading_time: { severity: "high", effort: "project", label: "Slow-loading pages" },
  large_page_size: { severity: "medium", effort: "project", label: "Oversized pages" },
  no_image_alt: { severity: "low", effort: "quick", label: "Images missing alt text" },
  is_orphan_page: { severity: "medium", effort: "moderate", label: "Orphan pages (no internal links in)" },
  is_https: { severity: "high", effort: "project", label: "Pages not served over HTTPS" },
  no_favicon: { severity: "low", effort: "quick", label: "Missing favicon" },
};

function lensLabel(lens: Lens): string {
  return LENS_META[lens].name;
}

/** De-duplicate (preserving order) and bound a URL list per the contract. */
function boundUrls(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= MAX_ACTION_URLS) break;
  }
  return out;
}

function weakSignalSeverity(score: number): ActionSeverity {
  if (score < 35) return "high";
  if (score < 55) return "medium";
  return "low";
}

function commonFindingSeverity(count: number): ActionSeverity {
  if (count >= 5) return "critical";
  if (count >= 3) return "high";
  return "medium";
}

// --- Per-source builders -----------------------------------------------------

function itemsFromFindings(findings: AuditFindings, url: string | undefined): ActionItem[] {
  const urls = url ? [url] : [];
  const items: ActionItem[] = [];

  findings.blockers.forEach((blocker, i) => {
    items.push({
      id: `blocker-${i}`,
      severity: "critical",
      title: blocker.issue,
      detail: blocker.location
        ? `Blocks AI-Overview citation — ${blocker.location}.`
        : "Blocks AI-Overview citation.",
      source: "S18",
      urls,
      effort: "moderate",
    });
  });

  findings.questionGaps.forEach((gap, i) => {
    items.push({
      id: `gap-${i}`,
      severity: "medium",
      title: `Answer: ${gap}`,
      detail: "A question a thorough article on this topic should answer but doesn't.",
      source: "S13",
      urls,
      effort: "moderate",
    });
  });

  return items;
}

function itemsFromCaps(scores: ScoreBreakdown, url: string | undefined): ActionItem[] {
  const urls = url ? [url] : [];
  const items: ActionItem[] = [];
  for (const lens of LENSES) {
    const lensScore = scores.lenses[lens];
    if (!lensScore.capped || !lensScore.capReason) continue;
    items.push({
      id: `cap-${lens}`,
      severity: "high",
      title: `${lensLabel(lens)} is capped at ${lensScore.score}`,
      detail: lensScore.capReason,
      source: `cap:${lens}`,
      urls,
      effort: "moderate",
    });
  }
  return items;
}

function itemsFromWeakSignals(scores: ScoreBreakdown, url: string | undefined): ActionItem[] {
  const urls = url ? [url] : [];
  // computeRoadmap ranks every weak signal by its true scoring impact using
  // the frozen engine weights — reuse it rather than re-deriving the math.
  return computeRoadmap(scores)
    .filter((item) => item.score < WEAK_SIGNAL_CEIL)
    .map((item) => ({
      id: `signal-${item.signalId}`,
      severity: weakSignalSeverity(item.score),
      title: `${item.label} scored ${item.score}`,
      detail: SIGNAL_META[item.signalId].blurb,
      source: item.signalId,
      urls,
      effort: EFFORT_BY_BUCKET[item.bucket],
    }));
}

function itemsFromRollup(rollup: SiteRollup, rootUrl: string | undefined): ActionItem[] {
  const items: ActionItem[] = [];

  rollup.commonFindings.forEach((finding, i) => {
    items.push({
      id: `common-${i}`,
      severity: commonFindingSeverity(finding.count),
      title: finding.issue,
      detail: `Recurs on ${finding.count} pages — fix it site-wide, not page by page.`,
      source: "site:common",
      urls: rootUrl ? [rootUrl] : [],
      effort: "moderate",
    });
  });

  if (rollup.worstPages.length > 0) {
    const worstUrls = boundUrls(rollup.worstPages.map((page) => page.url));
    const lowest = rollup.worstPages[0];
    items.push({
      id: "worst-pages",
      severity: "high",
      title: `Prioritize the ${rollup.worstPages.length} lowest-scoring pages`,
      detail: `The weakest page scores ${lowest.overallScore}. Bringing the worst pages up lifts the site average fastest.`,
      source: "site:worst",
      urls: worstUrls,
      effort: "project",
    });
  }

  return items;
}

/** One page carrying its DataForSEO technical issue keys. */
export interface TechnicalIssuePage {
  url: string;
  issueKeys: string[];
}

function itemsFromTechnical(pages: readonly TechnicalIssuePage[]): ActionItem[] {
  const byKey = new Map<string, string[]>();
  for (const page of pages) {
    for (const key of page.issueKeys) {
      const list = byKey.get(key) ?? [];
      list.push(page.url);
      byKey.set(key, list);
    }
  }

  const items: ActionItem[] = [];
  for (const [key, urls] of byKey) {
    const meta = TECHNICAL_ISSUE_META[key];
    const severity = meta?.severity ?? "medium";
    const effort = meta?.effort ?? "moderate";
    const label = meta?.label ?? key.replace(/_/g, " ");
    items.push({
      id: `issue-${key}`,
      severity,
      title: label,
      detail: `${urls.length} page${urls.length === 1 ? "" : "s"} affected (DataForSEO on-page check \`${key}\`).`,
      source: `issue:${key}`,
      urls: boundUrls(urls),
      effort,
    });
  }
  return items;
}

// --- Assembly ----------------------------------------------------------------

/** Everything the synthesizer can draw from. Every field is optional; the plan
 * is built from whatever is present. */
export interface ActionPlanSources {
  /** ISO timestamp stamped onto the plan (injected so the synthesis stays pure). */
  generatedAt: string;
  /** The page/site URL these findings belong to; populates each item's `urls`. */
  url?: string;
  findings?: AuditFindings | null;
  scores?: ScoreBreakdown | null;
  rollup?: SiteRollup | null;
  technicalPages?: readonly TechnicalIssuePage[] | null;
}

/**
 * Stable sort by severity (critical → low), then by breadth (URLs affected),
 * then by title so the order is deterministic for identical input.
 */
function sortItems(items: ActionItem[]): ActionItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[a.item.severity] - SEVERITY_RANK[b.item.severity];
      if (bySeverity !== 0) return bySeverity;
      const byBreadth = b.item.urls.length - a.item.urls.length;
      if (byBreadth !== 0) return byBreadth;
      const byTitle = a.item.title.localeCompare(b.item.title);
      if (byTitle !== 0) return byTitle;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

/** Build a severity-ranked action plan from whatever audit data is available. */
export function buildActionPlan(sources: ActionPlanSources): ActionPlan {
  const items: ActionItem[] = [];

  if (sources.findings) items.push(...itemsFromFindings(sources.findings, sources.url));
  if (sources.scores) {
    items.push(...itemsFromCaps(sources.scores, sources.url));
    items.push(...itemsFromWeakSignals(sources.scores, sources.url));
  }
  if (sources.rollup) items.push(...itemsFromRollup(sources.rollup, sources.url));
  if (sources.technicalPages && sources.technicalPages.length > 0) {
    items.push(...itemsFromTechnical(sources.technicalPages));
  }

  return {
    items: sortItems(items).slice(0, MAX_ACTION_ITEMS),
    generatedAt: sources.generatedAt,
  };
}

/** Convenience: an action plan for one single-page report. */
export function actionPlanForReport(report: AuditReport, generatedAt: string): ActionPlan {
  return buildActionPlan({
    generatedAt,
    url: report.page.finalUrl,
    findings: report.findings,
    scores: report.scores,
  });
}

/** Convenience: an action plan for one whole-site rollup. */
export function actionPlanForSite(
  rootUrl: string,
  rollup: SiteRollup | null,
  generatedAt: string,
  technicalPages?: readonly TechnicalIssuePage[] | null,
): ActionPlan {
  return buildActionPlan({ generatedAt, url: rootUrl, rollup, technicalPages });
}

const SEVERITY_EXPORT_LABEL: Record<ActionSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const EFFORT_EXPORT_LABEL: Record<ActionEffort, string> = {
  quick: "quick",
  moderate: "moderate",
  project: "project",
};

/** Markdown lines for the "Action plan" section, shared by every exporter. */
export function actionPlanMarkdownLines(plan: ActionPlan): string[] {
  if (plan.items.length === 0) return ["No action items — every checked signal is in good shape."];
  return plan.items.map(
    (item) =>
      `- [ ] **${SEVERITY_EXPORT_LABEL[item.severity]}** · ${item.title} _(${EFFORT_EXPORT_LABEL[item.effort]})_ — ${item.detail}`,
  );
}
