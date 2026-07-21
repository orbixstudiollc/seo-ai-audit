import type { BusinessType } from "./businessType";
import type { SkillId } from "./types";

/**
 * SK3-BE — the agent orchestrator's plan step (DATA-CONTRACT §9). A literal,
 * table-driven plan builder: every business type gets the same free core +
 * paid inline pair + a technical-crawl handoff, with a couple of
 * business-type-conditional additions. Caps are enforced by dropping the
 * lowest-priority (least essential) items first — never the free core.
 */

export interface AgentPlanItem {
  skillId: SkillId;
  mode: "inline" | "handoff";
  estCostUsd: number;
}

export interface AgentPlanCaps {
  maxSkills: number;
  maxRunUsd: number;
}

export interface BuildAgentPlanInput {
  businessType: BusinessType;
  hasAlternates: boolean;
  caps: AgentPlanCaps;
}

const FREE_CORE: readonly AgentPlanItem[] = [
  { skillId: "schema", mode: "inline", estCostUsd: 0 },
  { skillId: "sitemap", mode: "inline", estCostUsd: 0 },
  { skillId: "images", mode: "inline", estCostUsd: 0 },
  { skillId: "ai-access", mode: "inline", estCostUsd: 0 },
];

const HREFLANG_ITEM: AgentPlanItem = { skillId: "hreflang", mode: "inline", estCostUsd: 0 };
const LABS_ITEM: AgentPlanItem = { skillId: "labs", mode: "inline", estCostUsd: 0.03 };
const BACKLINKS_ITEM: AgentPlanItem = { skillId: "backlinks", mode: "inline", estCostUsd: 0.03 };
const KEYWORDS_ITEM: AgentPlanItem = { skillId: "keywords", mode: "inline", estCostUsd: 0.08 };
const TECHNICAL_CRAWL_ITEM: AgentPlanItem = { skillId: "technical-crawl", mode: "handoff", estCostUsd: 0.10 };

/** Business types that also get a keyword search-volume pull. */
const KEYWORDS_BUSINESS_TYPES: ReadonlySet<BusinessType> = new Set(["saas", "agency", "local"]);

/** Drop order when caps are exceeded: least essential first. The free core
 * (schema/sitemap/images/ai-access[/hreflang]) is never dropped. */
const DROP_ORDER: readonly SkillId[] = ["keywords", "backlinks", "labs", "technical-crawl"];

const CAP_EPSILON = 1e-9;

function withinCaps(items: readonly AgentPlanItem[], caps: AgentPlanCaps): boolean {
  const sum = items.reduce((total, item) => total + item.estCostUsd, 0);
  return items.length <= caps.maxSkills && sum <= caps.maxRunUsd + CAP_EPSILON;
}

/** Builds the skill plan for one agent run, enforcing `caps` by construction. */
export function buildAgentPlan(input: BuildAgentPlanInput): AgentPlanItem[] {
  let items: AgentPlanItem[] = [...FREE_CORE];
  if (input.hasAlternates) items.push(HREFLANG_ITEM);
  items.push(LABS_ITEM, BACKLINKS_ITEM);
  if (KEYWORDS_BUSINESS_TYPES.has(input.businessType)) items.push(KEYWORDS_ITEM);
  items.push(TECHNICAL_CRAWL_ITEM);

  for (const dropId of DROP_ORDER) {
    if (withinCaps(items, input.caps)) break;
    items = items.filter((item) => item.skillId !== dropId);
  }

  return items;
}
