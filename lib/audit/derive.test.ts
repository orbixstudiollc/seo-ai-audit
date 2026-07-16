import { describe, it, expect } from "vitest";
import {
  DET_SIGNAL_IDS,
  LENSES,
  LENS_WEIGHTS,
  RUB_SIGNAL_IDS,
  SIGNAL_IDS,
  type ScoreBreakdown,
  type SignalId,
  type SignalResult,
} from "@aeo/scoring";
import { blendBreakdown, buildFindingItems, computeRoadmap } from "./derive";
import type { AuditFindings } from "./types";

/** Full 18-signal baseline with every RUB signal pinned to `rub`. blend
 * recomputes the DET half from content, so the DET placeholders here are
 * only there to satisfy the Record<SignalId, SignalResult> type. */
function baselineWithRub(rub: number): ScoreBreakdown {
  const det = DET_SIGNAL_IDS.map((id) => [id, { id, score: 0, detail: {} }] as const);
  const rubs = RUB_SIGNAL_IDS.map((id) => [id, { id, score: rub, evidence: null }] as const);
  return {
    lenses: {
      aeo: { lens: "aeo", score: 0, capped: false },
      geo: { lens: "geo", score: 0, capped: false },
      citability: { lens: "citability", score: 0, capped: false },
      aiOverview: { lens: "aiOverview", score: 0, capped: false },
    },
    signals: Object.fromEntries([...det, ...rubs]) as Record<SignalId, SignalResult>,
    rubricVersion: "test",
    signalsVersion: "test",
    modelId: "mock",
  };
}

const STRONG_ARTICLE = `# What is a heat pump?

A heat pump moves heat rather than generating it, which makes it about 300% efficient. It works in cold climates down to -15°C.

## How does a heat pump work in winter?

It extracts ambient heat from outdoor air, even at -15°C, and concentrates it. According to the U.S. Department of Energy, modern units keep 100% capacity to 5°F.

## What does a heat pump cost?

A typical install runs $4,000 to $8,000. Rebates cover up to $2,000 in many states.
`;

// A fluff-opener intro that is also over-length -> S1 scores 0, which trips
// the AI Overview hard cap (capped at 40 when S1 < 30).
const FLUFF_ARTICLE = `# Heat pumps

In today's fast-paced world there are many many considerations people weigh when they try to understand this topic deeply and thoroughly and this opening paragraph deliberately runs well past seventy five words while beginning with a recognised fluff opener phrase so that the answer first intro signal scores a flat zero which is exactly what we need in order to exercise the deterministic hard cap that pins the AI Overview lens to forty points regardless of how strong the rubric signals happen to be in this focused test.

## What is a heat pump?

A heat pump moves heat, achieving 300% efficiency. According to the DOE it holds capacity to 5°F.
`;

describe("lens weight invariant", () => {
  it("every lens weight vector sums to exactly 100", () => {
    for (const lens of LENSES) {
      const sum = Object.values(LENS_WEIGHTS[lens]).reduce((a, b) => a + (b ?? 0), 0);
      expect(sum).toBe(100);
    }
  });
});

describe("blendBreakdown", () => {
  it("returns lens scores that are quantized to steps of 5 within 0..100", () => {
    const result = blendBreakdown(STRONG_ARTICLE, false, baselineWithRub(90));
    for (const lens of LENSES) {
      const score = result.lenses[lens].score;
      expect(score % 5).toBe(0);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("preserves the baseline RUB signals unchanged", () => {
    const result = blendBreakdown(STRONG_ARTICLE, false, baselineWithRub(85));
    for (const id of RUB_SIGNAL_IDS) {
      expect(result.signals[id].score).toBe(85);
    }
  });

  it("applies the AI Overview hard cap when the intro signal collapses", () => {
    const result = blendBreakdown(FLUFF_ARTICLE, false, baselineWithRub(100));
    expect(result.signals.S1.score).toBeLessThan(30);
    expect(result.lenses.aiOverview.capped).toBe(true);
    expect(result.lenses.aiOverview.score).toBe(40);
  });
});

describe("computeRoadmap", () => {
  it("orders items by descending impact and omits maxed signals", () => {
    const breakdown = blendBreakdown(STRONG_ARTICLE, false, baselineWithRub(60));
    const roadmap = computeRoadmap(breakdown);
    expect(roadmap.length).toBeGreaterThan(0);
    for (let i = 1; i < roadmap.length; i++) {
      expect(roadmap[i - 1].impact).toBeGreaterThanOrEqual(roadmap[i].impact);
    }
    expect(roadmap.every((item) => item.score < 100)).toBe(true);
  });
});

describe("buildFindingItems", () => {
  it("ranks blockers before gaps before weak signals", () => {
    const breakdown = blendBreakdown(STRONG_ARTICLE, false, baselineWithRub(20));
    const findings: AuditFindings = {
      questionGaps: ["What maintenance does a heat pump need?"],
      anchorSuggestions: [],
      blockers: [{ issue: "Answer buried in paragraph 3", location: "opening section" }],
      qaPairs: [],
      quotables: [],
    };
    const items = buildFindingItems(breakdown, findings);
    const severities = items.map((i) => i.severity);
    expect(severities[0]).toBe("blocker");
    expect(severities.includes("gap")).toBe(true);
    expect(severities.includes("weak")).toBe(true);
    // gaps must all precede weak signals
    const lastGap = severities.lastIndexOf("gap");
    const firstWeak = severities.indexOf("weak");
    expect(lastGap).toBeLessThan(firstWeak);
  });
});

// Guards the SIGNAL_IDS import stays used (all 18 signals wired into meta).
describe("signal coverage", () => {
  it("covers all 18 signals", () => {
    expect(SIGNAL_IDS.length).toBe(18);
  });
});
