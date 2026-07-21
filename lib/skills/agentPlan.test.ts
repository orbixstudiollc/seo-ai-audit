import { describe, expect, it } from "vitest";
import { buildAgentPlan } from "./agentPlan";

const GENEROUS_CAPS = { maxSkills: 20, maxRunUsd: 100 };

describe("buildAgentPlan", () => {
  it("builds the free core + paid pair + technical-crawl handoff for a general site", () => {
    const plan = buildAgentPlan({ businessType: "general", hasAlternates: false, caps: GENEROUS_CAPS });
    expect(plan.map((item) => item.skillId)).toEqual([
      "schema", "sitemap", "images", "ai-access", "labs", "backlinks", "technical-crawl",
    ]);
    expect(plan.find((item) => item.skillId === "technical-crawl")).toEqual({
      skillId: "technical-crawl", mode: "handoff", estCostUsd: 0.10,
    });
  });

  it("adds hreflang (free) only when the page has alternates", () => {
    const withAlternates = buildAgentPlan({ businessType: "general", hasAlternates: true, caps: GENEROUS_CAPS });
    expect(withAlternates.map((i) => i.skillId)).toContain("hreflang");
    expect(withAlternates.find((i) => i.skillId === "hreflang")?.estCostUsd).toBe(0);

    const without = buildAgentPlan({ businessType: "general", hasAlternates: false, caps: GENEROUS_CAPS });
    expect(without.map((i) => i.skillId)).not.toContain("hreflang");
  });

  it.each(["saas", "agency", "local"] as const)("adds keywords for %s", (businessType) => {
    const plan = buildAgentPlan({ businessType, hasAlternates: false, caps: GENEROUS_CAPS });
    expect(plan.map((i) => i.skillId)).toContain("keywords");
  });

  it.each(["ecommerce", "publisher", "general"] as const)("does not add keywords for %s", (businessType) => {
    const plan = buildAgentPlan({ businessType, hasAlternates: false, caps: GENEROUS_CAPS });
    expect(plan.map((i) => i.skillId)).not.toContain("keywords");
  });

  it("drops keywords, then backlinks, then labs, then technical-crawl, in that order, as maxSkills tightens", () => {
    const base = { businessType: "saas" as const, hasAlternates: false };
    // Full plan: schema, sitemap, images, ai-access, labs, backlinks, keywords, technical-crawl (8).
    expect(buildAgentPlan({ ...base, caps: { maxSkills: 8, maxRunUsd: 100 } }).map((i) => i.skillId)).toHaveLength(8);

    const drop1 = buildAgentPlan({ ...base, caps: { maxSkills: 7, maxRunUsd: 100 } });
    expect(drop1.map((i) => i.skillId)).not.toContain("keywords");
    expect(drop1).toHaveLength(7);

    const drop2 = buildAgentPlan({ ...base, caps: { maxSkills: 6, maxRunUsd: 100 } });
    expect(drop2.map((i) => i.skillId)).toEqual(
      expect.not.arrayContaining(["keywords", "backlinks"]),
    );
    expect(drop2).toHaveLength(6);

    const drop3 = buildAgentPlan({ ...base, caps: { maxSkills: 5, maxRunUsd: 100 } });
    expect(drop3.map((i) => i.skillId)).toEqual(["schema", "sitemap", "images", "ai-access", "technical-crawl"]);

    // Free core alone is 4 — nothing left to drop below that.
    const drop4 = buildAgentPlan({ ...base, caps: { maxSkills: 4, maxRunUsd: 100 } });
    expect(drop4.map((i) => i.skillId)).toEqual(["schema", "sitemap", "images", "ai-access"]);
  });

  it("is free-only when maxRunUsd is 0 (kill switch), regardless of maxSkills", () => {
    const plan = buildAgentPlan({ businessType: "saas", hasAlternates: true, caps: { maxSkills: 20, maxRunUsd: 0 } });
    expect(plan.every((item) => item.estCostUsd === 0)).toBe(true);
    expect(plan.map((i) => i.skillId).sort()).toEqual(["ai-access", "hreflang", "images", "schema", "sitemap"].sort());
  });

  it.each([
    { businessType: "general" as const, hasAlternates: false, caps: { maxSkills: 8, maxRunUsd: 0.25 } },
    { businessType: "saas" as const, hasAlternates: true, caps: { maxSkills: 3, maxRunUsd: 0.05 } },
    { businessType: "ecommerce" as const, hasAlternates: false, caps: { maxSkills: 100, maxRunUsd: 5 } },
  ])("is cap-compliant by construction for %j", (input) => {
    const plan = buildAgentPlan(input);
    const sum = plan.reduce((total, item) => total + item.estCostUsd, 0);
    expect(sum).toBeLessThanOrEqual(input.caps.maxRunUsd + 1e-9);
    // Everything outside DROP_ORDER (the free core, +hreflang when alternates
    // exist) is a floor buildAgentPlan won't drop below.
    const floor = input.hasAlternates ? 5 : 4;
    expect(plan.length).toBeLessThanOrEqual(Math.max(input.caps.maxSkills, floor));
  });
});
