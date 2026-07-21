import { safeFetchText } from "@/lib/import";
import type { AiAccessSkillResult } from "./types";

/**
 * AI-crawler access + llms.txt — $0, deterministic (seo-geo SKILL.md v2.2.4
 * "AI Crawler Detection" table). lib/discovery/robots.ts only resolves the
 * single `User-agent: *` group; this skill needs per-crawler-name groups
 * (GPTBot has its own group on many sites), so it parses robots.txt into
 * named groups itself — same longest-prefix-match policy, ~30 lines.
 */

const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "anthropic-ai",
  "PerplexityBot",
  "CCBot",
  "Bytespider",
  "cohere-ai",
] as const;

interface RobotsRule {
  type: "allow" | "disallow";
  value: string;
}

interface RobotsGroup {
  agents: string[]; // lowercased
  rules: RobotsRule[];
}

/** Parses robots.txt into its `User-agent:` groups (consecutive User-agent
 * lines share the Allow/Disallow rules that follow them). */
export function parseRobotsGroups(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let sawRuleSinceAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const field = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();

    if (field === "user-agent") {
      if (current === null || sawRuleSinceAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
        sawRuleSinceAgent = false;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (current === null) continue;
    if (field === "disallow" && value) {
      current.rules.push({ type: "disallow", value });
      sawRuleSinceAgent = true;
    } else if (field === "allow" && value) {
      current.rules.push({ type: "allow", value });
      sawRuleSinceAgent = true;
    }
  }
  return groups;
}

function longestMatch(rules: RobotsRule[], type: "allow" | "disallow", pathname: string): number {
  let best = -1;
  for (const rule of rules) {
    if (rule.type !== type) continue;
    if (pathname.startsWith(rule.value) && rule.value.length > best) best = rule.value.length;
  }
  return best;
}

function isAllowedForGroup(group: RobotsGroup, pathname: string): boolean {
  const disallowDepth = longestMatch(group.rules, "disallow", pathname);
  if (disallowDepth === -1) return true;
  return longestMatch(group.rules, "allow", pathname) >= disallowDepth;
}

function winningGroupFor(groups: RobotsGroup[], uaLower: string): RobotsGroup | null {
  const named = groups.find((g) => g.agents.includes(uaLower));
  if (named) return named;
  return groups.find((g) => g.agents.includes("*")) ?? null;
}

/** true/false when a group (named or wildcard) governs this crawler,
 * "unspecified" when robots.txt is unreadable or no group covers it. */
function crawlerAccess(groups: RobotsGroup[] | null, name: string): boolean | "unspecified" {
  if (groups === null) return "unspecified";
  const group = winningGroupFor(groups, name.toLowerCase());
  if (group === null) return "unspecified";
  return isAllowedForGroup(group, "/");
}

const HEADING_RE = /^#{1,6}\s+\S/m;

export async function runAiAccess(url: string): Promise<AiAccessSkillResult> {
  const origin = new URL(url).origin;

  let groups: RobotsGroup[] | null = null;
  try {
    const res = await safeFetchText(new URL("/robots.txt", origin).toString(), {
      maxBytes: 200_000,
      timeoutMs: 5_000,
    });
    if (res.status >= 200 && res.status < 300) groups = parseRobotsGroups(res.text);
  } catch {
    groups = null;
  }

  const crawlers = AI_CRAWLERS.map((name) => ({ name, allowed: crawlerAccess(groups, name) }));

  let llmsTxt: AiAccessSkillResult["llmsTxt"] = { present: false, hasSections: false, bytes: 0 };
  try {
    const res = await safeFetchText(new URL("/llms.txt", origin).toString(), {
      maxBytes: 200_000,
      timeoutMs: 5_000,
    });
    if (res.status >= 200 && res.status < 300) {
      llmsTxt = {
        present: true,
        hasSections: HEADING_RE.test(res.text),
        bytes: Buffer.byteLength(res.text, "utf-8"),
      };
    }
  } catch {
    // absent/unreachable llms.txt -> present: false (the default above)
  }

  return { crawlers, llmsTxt };
}
