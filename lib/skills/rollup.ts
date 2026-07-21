import { buildActionPlan, type ActionItem, type TechnicalIssuePage } from "./actionPlan";
import type {
  AiAccessSkillResult,
  BacklinksSkillResult,
  HreflangSkillResult,
  ImagesSkillResult,
  LabsSkillResult,
  SchemaSkillResult,
  SitemapSkillResult,
  SkillId,
  SkillTask,
} from "./types";
import type { AuditFindings, SiteRollup } from "@/lib/audit/types";
import type { ScoreBreakdown } from "@aeo/scoring";

/**
 * SK3-BE — per-skill `SkillTask.result` -> `ActionItem[]` mappers, plus
 * `buildAgentRollup`, the agent orchestrator's DATA-CONTRACT §10 synthesis
 * step. Every mapper lives here (not in the SK1/SK2 skill modules) so those
 * stay $0/deterministic-result producers with no opinion on severity/effort.
 */

/** Slugify free text into a stable, content-derived id suffix (same
 * discipline as actionPlan.ts's stableId, kept local to avoid reaching into
 * that module for a 3-line helper). */
function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function humanize(code: string): string {
  const words = code.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function urlsFor(url: string | undefined): string[] {
  return url ? [url] : [];
}

// --- schema ------------------------------------------------------------------

export function schemaToItems(result: SchemaSkillResult, url: string | undefined): ActionItem[] {
  const urls = urlsFor(url);
  const items: ActionItem[] = [];

  for (const type of result.missingRecommended) {
    items.push({
      id: `schema-missing-${slug(type)}`,
      severity: "medium",
      title: `Add ${type} structured data`,
      detail: `No ${type} JSON-LD was found on this page — search engines and AI assistants can't cite it as ${type} data.`,
      source: "schema",
      urls,
      effort: "quick",
    });
  }

  for (const detected of result.detected) {
    if (detected.errors.length > 0) {
      items.push({
        id: `schema-invalid-${slug(detected.type)}`,
        severity: "high",
        title: `${detected.type} schema has validation errors`,
        detail: detected.errors.join("; "),
        source: "schema",
        urls,
        effort: "quick",
      });
    }
    if (detected.warnings.length > 0) {
      items.push({
        id: `schema-warning-${slug(detected.type)}`,
        severity: "low",
        title: `${detected.type} schema warning`,
        detail: detected.warnings.join("; "),
        source: "schema",
        urls,
        effort: "quick",
      });
    }
  }

  return items;
}

// --- sitemap -------------------------------------------------------------

export function sitemapToItems(result: SitemapSkillResult, url: string | undefined): ActionItem[] {
  const urls = urlsFor(url);
  return result.issues.map((issue) => ({
    id: `sitemap-${issue.code}`,
    severity: issue.severity === "error" ? "high" : "medium",
    title: humanize(issue.code),
    detail: issue.detail,
    source: "sitemap",
    urls,
    effort: "quick",
  }));
}

// --- images ----------------------------------------------------------------

export function imagesToItems(result: ImagesSkillResult, url: string | undefined): ActionItem[] {
  const urls = urlsFor(url);
  const items: ActionItem[] = [];

  if (result.missingAlt.length > 0) {
    items.push({
      id: "images-missing-alt",
      severity: "medium",
      title: `${result.missingAlt.length} image(s) missing alt text`,
      detail: "Images without alt text are invisible to screen readers and image search.",
      source: "images",
      urls,
      effort: "quick",
    });
  }

  for (const issue of result.issues) {
    items.push({
      id: `images-${issue.code}`,
      severity: issue.code === "no-lazy-below-fold" ? "low" : "medium",
      title: `${issue.count} image(s): ${humanize(issue.code)}`,
      detail: humanize(issue.code),
      source: "images",
      urls,
      effort: "quick",
    });
  }

  if (result.oversized.length > 0) {
    items.push({
      id: "images-oversized",
      severity: "medium",
      title: `${result.oversized.length} oversized image(s)`,
      detail: "Images over 300KB slow down page load — compress or resize them.",
      source: "images",
      urls,
      effort: "moderate",
    });
  }

  return items;
}

// --- ai-access ---------------------------------------------------------------

export function aiAccessToItems(result: AiAccessSkillResult, url: string | undefined): ActionItem[] {
  const urls = urlsFor(url);
  const items: ActionItem[] = [];

  for (const crawler of result.crawlers) {
    if (crawler.allowed !== false) continue;
    items.push({
      id: `ai-access-blocked-${slug(crawler.name)}`,
      severity: "medium",
      title: `${crawler.name} is blocked by robots.txt`,
      detail: `${crawler.name} cannot crawl this site — it won't be able to cite this content in AI answers.`,
      source: "ai-access",
      urls,
      effort: "quick",
    });
  }

  if (!result.llmsTxt.present) {
    items.push({
      id: "ai-access-missing-llms-txt",
      severity: "low",
      title: "No llms.txt found",
      detail: "llms.txt helps AI crawlers understand your site structure.",
      source: "ai-access",
      urls,
      effort: "quick",
    });
  }

  return items;
}

// --- hreflang ------------------------------------------------------------

const HIGH_SEVERITY_HREFLANG_CHECKS = new Set(["valid-codes", "self-reference"]);

export function hreflangToItems(result: HreflangSkillResult, url: string | undefined): ActionItem[] {
  const fallbackUrls = urlsFor(url);
  return result.checks
    .filter((check) => !check.pass)
    .map((check) => ({
      id: `hreflang-${check.code}`,
      severity: HIGH_SEVERITY_HREFLANG_CHECKS.has(check.code) ? "high" : "medium",
      title: humanize(check.code),
      detail: check.detail,
      source: "hreflang",
      urls: check.urls.length > 0 ? check.urls.slice(0, 20) : fallbackUrls,
      effort: "quick",
    }));
}

// --- backlinks -----------------------------------------------------------

export function backlinksToItems(result: BacklinksSkillResult, url: string | undefined): ActionItem[] {
  const urls = urlsFor(url);
  const items: ActionItem[] = [];

  if (result.totalBacklinks === 0) {
    items.push({
      id: "backlinks-none",
      severity: "medium",
      title: "No backlinks detected",
      detail: "This site has no known referring domains — link building would help authority.",
      source: "backlinks",
      urls,
      effort: "project",
    });
  }

  if (result.brokenBacklinks > 0) {
    items.push({
      id: "backlinks-broken",
      severity: "medium",
      title: `${result.brokenBacklinks} broken backlink(s)`,
      detail: "Broken backlinks point to pages that no longer resolve — reclaim them with redirects.",
      source: "backlinks",
      urls,
      effort: "moderate",
    });
  }

  return items;
}

// --- labs ------------------------------------------------------------------

const STRIKING_DISTANCE_MIN_RANK = 8;
const STRIKING_DISTANCE_MAX_RANK = 20;

export function labsToItems(result: LabsSkillResult, url: string | undefined): ActionItem[] {
  const strikingDistance = result.rows.filter(
    (row) => row.position !== null && row.position >= STRIKING_DISTANCE_MIN_RANK && row.position <= STRIKING_DISTANCE_MAX_RANK,
  );
  if (strikingDistance.length === 0) return [];
  return [{
    id: "labs-striking-distance",
    severity: "medium",
    title: `${strikingDistance.length} keyword(s) in striking distance (positions 8-20)`,
    detail: "These keywords rank close to page 1 — targeted improvements could push them onto page 1.",
    source: "labs",
    urls: urlsFor(url),
    effort: "moderate",
  }];
}

// --- assembly ----------------------------------------------------------------

function itemsForSkill(skillId: string, task: SkillTask, url: string): ActionItem[] {
  if (task.status !== "complete" || task.result === null) return [];
  switch (skillId as SkillId) {
    case "schema": return schemaToItems(task.result as SchemaSkillResult, url);
    case "sitemap": return sitemapToItems(task.result as SitemapSkillResult, url);
    case "images": return imagesToItems(task.result as ImagesSkillResult, url);
    case "ai-access": return aiAccessToItems(task.result as AiAccessSkillResult, url);
    case "hreflang": return hreflangToItems(task.result as HreflangSkillResult, url);
    case "backlinks": return backlinksToItems(task.result as BacklinksSkillResult, url);
    case "labs": return labsToItems(task.result as LabsSkillResult, url);
    default: return []; // no mapper (e.g. keywords, technical-crawl is handled via technicalPages)
  }
}

export interface BuildAgentRollupInput {
  url: string;
  skillResults: Record<string, SkillTask>;
  storedFindings?: AuditFindings | null;
  storedScores?: ScoreBreakdown | null;
  storedRollup?: SiteRollup | null;
  technicalPages?: readonly TechnicalIssuePage[] | null;
}

/** Merges every completed skill's action items with whatever stored
 * audit/site data is available into one severity-ranked plan. Always
 * produces a plan, even when every skill in `skillResults` failed or is
 * still pending (an empty/near-empty `extraItems` just yields fewer items). */
export function buildAgentRollup(input: BuildAgentRollupInput) {
  const extraItems: ActionItem[] = [];
  for (const [skillId, task] of Object.entries(input.skillResults)) {
    extraItems.push(...itemsForSkill(skillId, task, input.url));
  }

  return buildActionPlan({
    generatedAt: new Date().toISOString(),
    url: input.url,
    findings: input.storedFindings ?? null,
    scores: input.storedScores ?? null,
    rollup: input.storedRollup ?? null,
    technicalPages: input.technicalPages ?? null,
    extraItems,
  });
}
