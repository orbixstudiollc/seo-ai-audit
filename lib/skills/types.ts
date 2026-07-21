import type { Lens } from "@aeo/scoring";
import type { ActionPlan } from "./actionPlan";

/**
 * DATA-CONTRACT §8 (SkillTask envelope) + §8.1 (typed results) + §9
 * (agent-mode events), copied verbatim — coordinator-owned (SK0), the law
 * for every skill backend and renderer. Additions here go through the
 * contract first.
 */

export type SkillId =
  | "schema" | "sitemap" | "hreflang" | "images" | "sxo"
  | "ai-access"
  | "serp" | "keywords" | "backlinks" | "labs"
  | "technical-crawl" | "gsc" | "ga4" | "action-plan" | "brief" | "compare";

export type SkillTaskStatus =
  | "creating"   // reserved row, provider not yet called
  | "queued" | "running"
  | "complete" | "failed";

export interface SkillScope { kind: "page" | "site" | "keyword"; url?: string; keyword?: string; }

export interface SkillTask<TResult = unknown> {
  id: string;                 // uuid
  skillId: SkillId;
  scope: SkillScope;
  status: SkillTaskStatus;
  createdAt: string;
  updatedAt: string;
  /** Actual provider cost in USD (0 for free/deterministic skills). */
  costUsd: number;
  /** Bump when a skill's result payload shape changes. */
  resultVersion: number;
  /** Present only when status === "complete". Opaque to the shell; typed per skill. */
  result: TResult | null;
  /** Present only when status === "failed". */
  error?: { kind: SkillErrorKind; message: string };
}

export type SkillErrorKind =
  | "invalid_input" | "fetch_failed" | "unsupported_content"
  | "provider_unavailable"   // env not configured (mirror technical-audit 503)
  | "budget_exceeded"        // reserve_spend denied (owner or global cap)
  | "rate_limit" | "server";

// --- §8.1 typed result payloads (resultVersion 1) ---------------------------

export interface SchemaSkillResult {
  detected: Array<{ type: string; valid: boolean; errors: string[]; warnings: string[] }>;
  missingRecommended: string[];
  generated: Array<{ type: string; jsonld: string }>;
}

export interface SitemapSkillResult {
  sitemapUrl: string | null;
  declaredInRobots: boolean;
  urlCount: number;
  sameOriginCount: number;
  issues: Array<{ code: string; severity: "error" | "warning"; detail: string }>;
}

export interface HreflangSkillResult {
  tags: Array<{ hreflang: string; href: string }>;
  checks: Array<{ code: string; pass: boolean; detail: string; urls: string[] }>;
}

export interface ImagesSkillResult {
  imageCount: number;
  /** src urls, ≤ 20. */
  missingAlt: string[];
  /** ≤ 10 (HEAD-sampled). */
  oversized: Array<{ url: string; bytes: number }>;
  issues: Array<{ code: string; count: number; urls: string[] }>;
}

export interface AiAccessSkillResult {
  crawlers: Array<{ name: string; allowed: boolean | "unspecified" }>;
  llmsTxt: { present: boolean; hasSections: boolean; bytes: number };
}

export interface SerpSkillResult {
  keyword: string;
  capturedAt: string;
  /** ≤ 20. */
  entries: Array<{ rank: number; url: string; title: string; domain: string; isOwn: boolean }>;
}

export interface KeywordsSkillResult {
  /** ≤ 100. */
  rows: Array<{ keyword: string; volume: number | null; cpc: number | null; competition: number | null }>;
}

export interface LabsSkillResult {
  /** ≤ 100. */
  rows: Array<{ keyword: string; position: number | null; volume: number | null; url: string | null }>;
}

export interface BacklinksSkillResult {
  totalBacklinks: number;
  referringDomains: number;
  rank: number | null;
  brokenBacklinks: number;
  referringDomainsNofollow: number;
}

export interface CompareSkillResult {
  keyword: string;
  mine: { url: string; scores: Record<Lens, number> | null };
  /** ≤ 3. */
  competitors: Array<{ rank: number; url: string; scores: Record<Lens, number> | null; topFindings: string[] }>;
}

/** Static map from skill id to its v1 result payload (mocks/tests/renderers). */
export interface SkillResultMap {
  "schema": SchemaSkillResult;
  "sitemap": SitemapSkillResult;
  "hreflang": HreflangSkillResult;
  "images": ImagesSkillResult;
  "ai-access": AiAccessSkillResult;
  "serp": SerpSkillResult;
  "keywords": KeywordsSkillResult;
  "labs": LabsSkillResult;
  "backlinks": BacklinksSkillResult;
  "compare": CompareSkillResult;
}

// --- §9 agent-mode run -------------------------------------------------------

export type AgentStreamEvent =
  | { type: "agent:plan"; runId: string; businessType: string;
      skills: Array<{ skillId: SkillId; mode: "inline" | "handoff"; estCostUsd: number }> }
  | { type: "agent:skill-start"; skillId: SkillId }
  | { type: "agent:skill-done";  skillId: SkillId; task: SkillTask }       // inline completion
  | { type: "agent:skill-handoff"; skillId: SkillId; taskId: string }      // poll via §8 GET
  | { type: "agent:rollup"; runId: string; actionPlan: ActionPlan;         // §10
      pendingTaskIds: string[] }                                           // may be non-empty
  | { type: "agent:done" }
  | { type: "agent:error"; kind: SkillErrorKind | "run_cap_exceeded"; message: string };
