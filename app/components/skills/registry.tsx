import type { ComponentType, ReactNode } from "react";
import type { SkillId, SkillTask } from "@/lib/skills/types";
import { SchemaResult } from "./results/SchemaResult";
import { SitemapResult } from "./results/SitemapResult";
import { HreflangResult } from "./results/HreflangResult";
import { ImagesResult } from "./results/ImagesResult";
import { AiAccessResult } from "./results/AiAccessResult";
import { SerpResult } from "./results/SerpResult";
import { KeywordsResult } from "./results/KeywordsResult";
import { LabsResult } from "./results/LabsResult";
import { BacklinksResult } from "./results/BacklinksResult";
import { CompareResult } from "./results/CompareResult";
import { TechnicalCrawlResult } from "./results/TechnicalCrawlResult";

export interface SkillRegistryEntry {
  /** Short name, used as the panel's Card label/heading. */
  label: string;
  /** External provider shown in the Card aside (paid skills only). */
  provider?: string;
  /** Idle-state headline. */
  title: string;
  /** Idle-state explanation of what the check does and what it costs. */
  description: string;
  costNote: string;
  startLabel: string;
  runningLabel: string;
  scopeKind: "site" | "page" | "keyword";
  /** SK1 ships the shell; routes land in later waves. Flip per-skill once
   * its app/api/skills/<id> route exists. */
  enabled: boolean;
  Result: ComponentType<{ task: SkillTask }>;
}

export const SKILL_REGISTRY: Partial<Record<SkillId, SkillRegistryEntry>> = {
  schema: {
    label: "Schema",
    title: "Validate structured data",
    description:
      "Checks this page's JSON-LD against schema.org, flags invalid or missing markup, and generates ready-to-paste JSON-LD for common types you're missing.",
    costNote: "Free",
    startLabel: "Run schema check",
    runningLabel: "Validating structured data…",
    scopeKind: "page",
    enabled: true,
    Result: SchemaResult,
  },
  sitemap: {
    label: "Sitemap",
    title: "Validate the sitemap",
    description:
      "Fetches sitemap.xml (and any index children), checks it's declared in robots.txt, and flags broken or out-of-scope URLs.",
    costNote: "Free",
    startLabel: "Run sitemap check",
    runningLabel: "Validating sitemap…",
    scopeKind: "site",
    enabled: true,
    Result: SitemapResult,
  },
  hreflang: {
    label: "Hreflang",
    title: "Check hreflang tags",
    description: "Validates this page's hreflang alternate links — reciprocal tags, valid language codes, and a self-reference.",
    costNote: "Free",
    startLabel: "Run hreflang check",
    runningLabel: "Checking hreflang tags…",
    scopeKind: "page",
    enabled: true,
    Result: HreflangResult,
  },
  images: {
    label: "Images",
    title: "Audit images",
    description: "Scans this page's images for missing alt text and oversized files that slow down load time.",
    costNote: "Free",
    startLabel: "Run image audit",
    runningLabel: "Auditing images…",
    scopeKind: "page",
    enabled: true,
    Result: ImagesResult,
  },
  "ai-access": {
    label: "AI access",
    title: "Check AI crawler access",
    description: "Checks robots.txt rules for major AI crawlers (GPTBot, ClaudeBot, PerplexityBot, …) and looks for an llms.txt file.",
    costNote: "Free",
    startLabel: "Run AI access check",
    runningLabel: "Checking AI crawler access…",
    scopeKind: "site",
    enabled: true,
    Result: AiAccessResult,
  },
  serp: {
    label: "SERP",
    provider: "DataForSEO",
    title: "Pull live SERP rankings",
    description: "Pulls the current top rankings for a keyword so you can see exactly where this page stands against the field.",
    costNote: "~$0.003 via DataForSEO SERP API",
    startLabel: "Run SERP pull",
    runningLabel: "Pulling live rankings…",
    scopeKind: "keyword",
    enabled: true,
    Result: SerpResult,
  },
  keywords: {
    label: "Keywords",
    provider: "DataForSEO",
    title: "Pull keyword metrics",
    description: "Pulls search volume, CPC, and competition for a keyword and its close variants.",
    costNote: "~$0.01 via DataForSEO Keywords Data API",
    startLabel: "Run keyword pull",
    runningLabel: "Pulling keyword metrics…",
    scopeKind: "keyword",
    enabled: true,
    Result: KeywordsResult,
  },
  labs: {
    label: "Labs",
    provider: "DataForSEO",
    title: "Pull ranked keywords",
    description: "Pulls the keywords this site already ranks for, with position and landing page, from DataForSEO Labs.",
    costNote: "~$0.01 via DataForSEO Labs API",
    startLabel: "Run ranked-keywords pull",
    runningLabel: "Pulling ranked keywords…",
    scopeKind: "site",
    enabled: true,
    Result: LabsResult,
  },
  backlinks: {
    label: "Backlinks",
    provider: "DataForSEO",
    title: "Pull backlink profile",
    description: "Pulls total backlinks, referring domains, and domain rank from DataForSEO's backlink index.",
    costNote: "~$0.02 via DataForSEO Backlinks API",
    startLabel: "Run backlink pull",
    runningLabel: "Pulling backlink profile…",
    scopeKind: "site",
    enabled: true,
    Result: BacklinksResult,
  },
  compare: {
    label: "Compare",
    provider: "DataForSEO",
    title: "Compare against competitors",
    description: "Runs the same scoring lenses against the top-ranking competitors for a keyword, side by side with your own page.",
    costNote: "~$0.05 via DataForSEO (SERP + on-demand scoring)",
    startLabel: "Run comparison",
    runningLabel: "Comparing against competitors…",
    scopeKind: "keyword",
    enabled: false,
    Result: CompareResult,
  },
  // Added for SK2's agent-mode handoff row (AgentReportView embeds SkillPanel
  // for this skill) — the real app/api/skills/technical-crawl route and its
  // typed §8.1 result payload are SK2-BE/SK3's to land; enabled here so the
  // handoff row can poll and render something in the meantime.
  "technical-crawl": {
    label: "Technical crawl",
    provider: "DataForSEO",
    title: "Run a reusable technical crawl",
    description: "Pulls status codes, crawl depth, on-page scores, and technical issue flags across the site.",
    costNote: "~$0.05 via DataForSEO OnPage API",
    startLabel: "Run technical crawl",
    runningLabel: "Crawling…",
    scopeKind: "site",
    enabled: true,
    Result: TechnicalCrawlResult,
  },
};

/** The site-hub tab's per-domain checks (DATA-CONTRACT §8 hub mocks). */
export const HUB_SKILL_IDS: SkillId[] = ["schema", "sitemap", "hreflang", "images", "ai-access", "backlinks", "labs", "serp", "keywords"];

/** Shared Card aside for a skill's external provider — used by SkillPanel and
 * the /dev/mock-skills page so both stay in sync with the registry. */
export function skillProviderAside(entry: SkillRegistryEntry): ReactNode {
  if (!entry.provider) return undefined;
  return <span className="font-mono text-[10px] uppercase tracking-wider text-text-3">{entry.provider}</span>;
}
