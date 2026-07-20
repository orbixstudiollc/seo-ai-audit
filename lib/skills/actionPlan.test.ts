import { describe, expect, it } from "vitest";
import type { Lens, ScoreBreakdown } from "@aeo/scoring";
import type { AuditFindings, SiteRollup } from "@/lib/audit/types";
import {
  buildActionPlan,
  actionPlanForSite,
  actionPlanMarkdownLines,
  MAX_ACTION_ITEMS,
  MAX_ACTION_URLS,
  type ActionItem,
} from "./actionPlan";

const AT = "2026-07-20T00:00:00.000Z";

/** A ScoreBreakdown with the given lens scores/caps and a sparse signal map.
 * Only the signals we assert on need to exist — computeRoadmap iterates the
 * keys present, exactly like the engine's real (dense) output. */
function fakeScores(
  lenses: Partial<Record<Lens, { score: number; capped?: boolean; capReason?: string }>>,
  signals: Record<string, number> = {},
): ScoreBreakdown {
  const lensEntry = (lens: Lens) => {
    const l = lenses[lens] ?? { score: 80 };
    return { lens, score: l.score, capped: l.capped ?? false, capReason: l.capReason };
  };
  return {
    lenses: {
      aeo: lensEntry("aeo"),
      geo: lensEntry("geo"),
      citability: lensEntry("citability"),
      aiOverview: lensEntry("aiOverview"),
    },
    signals: Object.fromEntries(Object.entries(signals).map(([id, score]) => [id, { id, score, detail: {} }])),
    rubricVersion: "test",
    signalsVersion: "test",
    modelId: "test",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function findings(partial: Partial<AuditFindings>): AuditFindings {
  return {
    questionGaps: [],
    anchorSuggestions: [],
    blockers: [],
    qaPairs: [],
    quotables: [],
    ...partial,
  };
}

const bySource = (items: ActionItem[], source: string) => items.find((i) => i.source === source);

describe("buildActionPlan — findings", () => {
  it("maps every AI-Overview blocker to a critical, moderate-effort item sourced from S18", () => {
    const plan = buildActionPlan({
      generatedAt: AT,
      url: "https://x/a",
      findings: findings({ blockers: [{ issue: "No answer block", location: "Intro" }] }),
    });
    const item = plan.items[0];
    expect(item.severity).toBe("critical");
    expect(item.effort).toBe("moderate");
    expect(item.source).toBe("S18");
    expect(item.urls).toEqual(["https://x/a"]);
    expect(item.title).toBe("No answer block");
  });

  it("maps question gaps to medium items sourced from S13", () => {
    const plan = buildActionPlan({
      generatedAt: AT,
      url: "https://x/a",
      findings: findings({ questionGaps: ["Is it free?"] }),
    });
    expect(plan.items[0].severity).toBe("medium");
    expect(plan.items[0].source).toBe("S13");
  });
});

describe("buildActionPlan — lens caps", () => {
  it("turns each capped lens with a reason into a high-severity item; ignores uncapped lenses", () => {
    const scores = fakeScores({
      citability: { score: 50, capped: true, capReason: "Stat density near zero." },
      aeo: { score: 65, capped: false },
    });
    const plan = buildActionPlan({ generatedAt: AT, url: "https://x/a", scores });
    const cap = bySource(plan.items, "cap:citability");
    expect(cap?.severity).toBe("high");
    expect(cap?.detail).toBe("Stat density near zero.");
    expect(bySource(plan.items, "cap:aeo")).toBeUndefined();
  });
});

describe("buildActionPlan — weak signals", () => {
  const plan = buildActionPlan({
    generatedAt: AT,
    url: "https://x/a",
    scores: fakeScores({}, { S1: 20, S15: 40, S8: 60, S3: 90 }),
  });

  it("grades severity by score band", () => {
    expect(bySource(plan.items, "S1")?.severity).toBe("high"); // < 35
    expect(bySource(plan.items, "S15")?.severity).toBe("medium"); // 35–54
    expect(bySource(plan.items, "S8")?.severity).toBe("low"); // 55–69
  });

  it("omits signals at or above the weak ceiling (70)", () => {
    expect(bySource(plan.items, "S3")).toBeUndefined();
  });

  it("tags effort from the roadmap bucket (DET quick, long-term RUB project)", () => {
    expect(bySource(plan.items, "S1")?.effort).toBe("quick"); // S1 is DET
    expect(bySource(plan.items, "S15")?.effort).toBe("project"); // S15 is long-term RUB
  });
});

describe("buildActionPlan — site rollup", () => {
  const rollup: SiteRollup = {
    pagesAudited: 6,
    pagesFailed: 0,
    avgScores: { aeo: 50, geo: 50, citability: 50, aiOverview: 50 },
    worstPages: [
      { url: "https://x/p1", title: "P1", overallScore: 20 },
      { url: "https://x/p2", title: "P2", overallScore: 30 },
    ],
    commonFindings: [
      { issue: "No intro answer", count: 5 },
      { issue: "Missing schema", count: 3 },
      { issue: "Thin section", count: 2 },
    ],
  };

  it("grades common findings by recurrence and adds one worst-pages project item", () => {
    const plan = actionPlanForSite("https://x", rollup, AT);
    expect(bySource(plan.items, "site:common")).toBeDefined();
    const commons = plan.items.filter((i) => i.source === "site:common");
    expect(commons.find((i) => i.title === "No intro answer")?.severity).toBe("critical"); // ≥5
    expect(commons.find((i) => i.title === "Missing schema")?.severity).toBe("high"); // ≥3
    expect(commons.find((i) => i.title === "Thin section")?.severity).toBe("medium"); // 2
    const worst = bySource(plan.items, "site:worst");
    expect(worst?.effort).toBe("project");
    expect(worst?.urls).toEqual(["https://x/p1", "https://x/p2"]);
  });
});

describe("buildActionPlan — technical issue keys", () => {
  it("groups pages by issue key, grades known keys, defaults unknown to medium, bounds URLs", () => {
    const technicalPages = [
      { url: "https://x/a", issueKeys: ["is_5xx_code", "made_up_key"] },
      { url: "https://x/b", issueKeys: ["is_5xx_code"] },
    ];
    const plan = buildActionPlan({ generatedAt: AT, technicalPages });
    const server = bySource(plan.items, "issue:is_5xx_code");
    expect(server?.severity).toBe("critical");
    expect(server?.urls).toEqual(["https://x/a", "https://x/b"]);
    expect(bySource(plan.items, "issue:made_up_key")?.severity).toBe("medium");
  });

  it("caps any item's URL list at MAX_ACTION_URLS", () => {
    const technicalPages = Array.from({ length: 30 }, (_, i) => ({ url: `https://x/p${i}`, issueKeys: ["no_title"] }));
    const plan = buildActionPlan({ generatedAt: AT, technicalPages });
    expect(bySource(plan.items, "issue:no_title")?.urls).toHaveLength(MAX_ACTION_URLS);
  });
});

describe("buildActionPlan — ordering and bounds", () => {
  it("sorts critical → high → medium → low", () => {
    const plan = buildActionPlan({
      generatedAt: AT,
      url: "https://x/a",
      findings: findings({ blockers: [{ issue: "b", location: "" }], questionGaps: ["q"] }),
      scores: fakeScores({ aeo: { score: 30, capped: true, capReason: "capped" } }, { S8: 60 }),
    });
    const ranks = plan.items.map((i) => i.severity);
    const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    for (let i = 1; i < ranks.length; i++) {
      expect(order[ranks[i]]).toBeGreaterThanOrEqual(order[ranks[i - 1]]);
    }
  });

  it("never exceeds MAX_ACTION_ITEMS", () => {
    const technicalPages = Array.from({ length: 80 }, (_, i) => ({ url: `https://x/p${i}`, issueKeys: [`key_${i}`] }));
    const plan = buildActionPlan({ generatedAt: AT, technicalPages });
    expect(plan.items.length).toBeLessThanOrEqual(MAX_ACTION_ITEMS);
  });

  it("is deterministic for identical input", () => {
    const sources = {
      generatedAt: AT,
      url: "https://x/a",
      findings: findings({ blockers: [{ issue: "b", location: "" }] }),
      scores: fakeScores({}, { S1: 20, S8: 60 }),
    };
    expect(buildActionPlan(sources)).toEqual(buildActionPlan(sources));
  });

  it("returns an empty item list (not an error) when there is nothing to synthesize", () => {
    const plan = buildActionPlan({ generatedAt: AT });
    expect(plan.items).toEqual([]);
    expect(plan.generatedAt).toBe(AT);
  });
});

describe("actionPlanMarkdownLines", () => {
  it("emits a checklist line per item with severity and effort", () => {
    const plan = buildActionPlan({
      generatedAt: AT,
      url: "https://x/a",
      findings: findings({ blockers: [{ issue: "No answer block", location: "Intro" }] }),
    });
    const lines = actionPlanMarkdownLines(plan);
    expect(lines[0]).toContain("**Critical**");
    expect(lines[0]).toContain("No answer block");
    expect(lines[0]).toContain("(moderate)");
  });

  it("emits a positive message when the plan is empty", () => {
    expect(actionPlanMarkdownLines(buildActionPlan({ generatedAt: AT }))).toEqual([
      "No action items — every checked signal is in good shape.",
    ]);
  });
});
