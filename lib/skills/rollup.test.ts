import { describe, expect, it } from "vitest";
import {
  aiAccessToItems,
  backlinksToItems,
  buildAgentRollup,
  hreflangToItems,
  imagesToItems,
  labsToItems,
  schemaToItems,
  sitemapToItems,
} from "./rollup";
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

const URL = "https://example.com/page";

function complete<T>(skillId: SkillId, result: T): SkillTask<T> {
  return { id: `${skillId}-task`, skillId, scope: { kind: "page", url: URL }, status: "complete", createdAt: "t", updatedAt: "t", costUsd: 0, resultVersion: 1, result };
}

function failed(skillId: SkillId): SkillTask {
  return {
    id: `${skillId}-task`, skillId, scope: { kind: "page", url: URL }, status: "failed",
    createdAt: "t", updatedAt: "t", costUsd: 0, resultVersion: 1, result: null,
    error: { kind: "fetch_failed", message: "boom" },
  };
}

describe("schemaToItems", () => {
  it("maps missing recommended types and invalid/warning detected schema", () => {
    const result: SchemaSkillResult = {
      detected: [{ type: "Article", valid: false, errors: ["Article is missing required property \"headline\""], warnings: [] }],
      missingRecommended: ["Organization"],
      generated: [{ type: "Organization", jsonld: "{}" }],
    };
    const items = schemaToItems(result, URL);
    expect(items.map((i) => i.id)).toEqual(["schema-missing-organization", "schema-invalid-article"]);
    expect(items[0].severity).toBe("medium");
    expect(items[1].severity).toBe("high");
    expect(items.every((i) => i.source === "schema")).toBe(true);
  });
});

describe("sitemapToItems", () => {
  it("maps error issues to high and warning issues to medium, with stable code-derived ids", () => {
    const result: SitemapSkillResult = {
      sitemapUrl: null, declaredInRobots: false, urlCount: 0, sameOriginCount: 0,
      issues: [
        { code: "missing-sitemap", severity: "error", detail: "No sitemap found" },
        { code: "not-declared-in-robots", severity: "warning", detail: "robots.txt has no Sitemap:" },
      ],
    };
    const items = sitemapToItems(result, URL);
    expect(items.map((i) => i.id)).toEqual(["sitemap-missing-sitemap", "sitemap-not-declared-in-robots"]);
    expect(items[0].severity).toBe("high");
    expect(items[1].severity).toBe("medium");
  });
});

describe("imagesToItems", () => {
  it("flags missing alt text as medium severity", () => {
    const result: ImagesSkillResult = { imageCount: 5, missingAlt: ["a.jpg", "b.jpg"], oversized: [], issues: [] };
    const items = imagesToItems(result, URL);
    expect(items).toEqual([expect.objectContaining({ id: "images-missing-alt", severity: "medium", source: "images" })]);
  });
});

describe("aiAccessToItems", () => {
  it("flags a blocked AI crawler as medium severity with a content-derived id", () => {
    const result: AiAccessSkillResult = {
      crawlers: [{ name: "GPTBot", allowed: false }, { name: "ClaudeBot", allowed: true }],
      llmsTxt: { present: true, hasSections: true, bytes: 100 },
    };
    const items = aiAccessToItems(result, URL);
    expect(items).toEqual([expect.objectContaining({ id: "ai-access-blocked-gptbot", severity: "medium" })]);
  });
});

describe("hreflangToItems", () => {
  it("only maps failing checks, using the check's own urls when present", () => {
    const result: HreflangSkillResult = {
      tags: [],
      checks: [
        { code: "self-reference", pass: false, detail: "No self-referencing tag", urls: [] },
        { code: "x-default", pass: true, detail: "ok", urls: [] },
      ],
    };
    const items = hreflangToItems(result, URL);
    expect(items).toEqual([expect.objectContaining({ id: "hreflang-self-reference", severity: "high", urls: [URL] })]);
  });
});

describe("backlinksToItems", () => {
  it("flags zero backlinks as a project-effort item", () => {
    const result: BacklinksSkillResult = { totalBacklinks: 0, referringDomains: 0, rank: null, brokenBacklinks: 0, referringDomainsNofollow: 0 };
    expect(backlinksToItems(result, URL)).toEqual([expect.objectContaining({ id: "backlinks-none", effort: "project" })]);
  });
});

describe("labsToItems", () => {
  it("flags striking-distance keywords (positions 8-20)", () => {
    const result: LabsSkillResult = { rows: [{ keyword: "seo audit", position: 12, volume: 100, url: URL }] };
    expect(labsToItems(result, URL)).toEqual([expect.objectContaining({ id: "labs-striking-distance" })]);
  });

  it("returns no items when nothing is in striking distance", () => {
    const result: LabsSkillResult = { rows: [{ keyword: "seo audit", position: 1, volume: 100, url: URL }] };
    expect(labsToItems(result, URL)).toEqual([]);
  });
});

describe("buildAgentRollup", () => {
  it("merges every completed skill's items, sorted by severity, with stable ids", () => {
    const skillResults: Record<string, SkillTask> = {
      schema: complete("schema", { detected: [], missingRecommended: ["Organization"], generated: [] } satisfies SchemaSkillResult),
      sitemap: failed("sitemap"), // failure must not throw and must not contribute items
      images: complete("images", { imageCount: 1, missingAlt: ["a.jpg"], oversized: [], issues: [] } satisfies ImagesSkillResult),
      "ai-access": complete("ai-access", {
        crawlers: [{ name: "GPTBot", allowed: false }],
        llmsTxt: { present: false, hasSections: false, bytes: 0 },
      } satisfies AiAccessSkillResult),
      backlinks: complete("backlinks", { totalBacklinks: 0, referringDomains: 0, rank: null, brokenBacklinks: 0, referringDomainsNofollow: 0 } satisfies BacklinksSkillResult),
    };

    const plan = buildAgentRollup({ url: URL, skillResults });

    const ids = plan.items.map((i) => i.id);
    expect(ids).toContain("schema-missing-organization");
    expect(ids).toContain("images-missing-alt");
    expect(ids).toContain("ai-access-blocked-gptbot");
    expect(ids).toContain("backlinks-none");
    // The failed sitemap task contributes nothing, but the plan is still built.
    expect(ids.some((id) => id.startsWith("sitemap-"))).toBe(false);

    // Severity-sorted: no "high" item appears after a "medium"/"low" one.
    const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    for (let i = 1; i < plan.items.length; i++) {
      expect(rank[plan.items[i].severity]).toBeGreaterThanOrEqual(rank[plan.items[i - 1].severity]);
    }
    expect(plan.items.length).toBeLessThanOrEqual(50);
  });

  it("still produces a (possibly empty) rollup when every skill failed", () => {
    const skillResults: Record<string, SkillTask> = { schema: failed("schema"), sitemap: failed("sitemap") };
    const plan = buildAgentRollup({ url: URL, skillResults });
    expect(plan.items).toEqual([]);
    expect(typeof plan.generatedAt).toBe("string");
  });

  it("folds in stored findings/scores/rollup/technicalPages alongside skill items", () => {
    const plan = buildAgentRollup({
      url: URL,
      skillResults: {},
      technicalPages: [{ url: URL, issueKeys: ["no_title"] }],
    });
    expect(plan.items.some((i) => i.source === "issue:no_title")).toBe(true);
  });
});
