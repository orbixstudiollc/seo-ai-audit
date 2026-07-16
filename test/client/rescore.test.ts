import { describe, expect, it } from "vitest";
import {
  RUB_SIGNAL_IDS,
  type RubSignalId,
  type RubSignalResult,
} from "@aeo/scoring";
import { blendBreakdown, estimateRescore } from "@/lib/audit/derive";

/**
 * The client-side estimated re-score (what useLocalRescore calls under the hood):
 * recompute the 11 DET signals from the edited working document and re-blend them
 * with the last-known RUB signals using the engine's own LENS_WEIGHTS + hard caps.
 * These are pure, synchronous functions — no React, no network — so they are
 * tested directly.
 */

/** A full RUB signal set pinned to one score, standing in for the last true audit. */
function fixedRub(score: number): Record<RubSignalId, RubSignalResult> {
  return Object.fromEntries(
    RUB_SIGNAL_IDS.map((id) => [id, { id, score, evidence: null } satisfies RubSignalResult]),
  ) as Record<RubSignalId, RubSignalResult>;
}

// A weak, buried-answer intro: a recognised fluff opener AND well over 75 words,
// so S1 (answer-first intro) collapses to ~0 and trips the AI Overview hard cap.
const WEAK_INTRO = `# Heat pumps

In today's fast-paced world there are many many considerations people weigh when they try to understand this topic deeply and thoroughly and this opening paragraph deliberately runs well past seventy five words while beginning with a recognised fluff opener phrase so that the answer first intro signal scores a flat zero which is exactly what we need in order to exercise the deterministic hard cap that pins the AI Overview lens to forty points regardless of how strong the rubric signals happen to be here.

## What is a heat pump?

A heat pump moves heat, achieving 300% efficiency. According to the DOE it holds capacity to 5F.
`;

// The same article after accepting the answer-first intro rewrite: the opening
// now states the answer in one short sentence, so S1 jumps.
const FIXED_INTRO = `# Heat pumps

A heat pump moves heat rather than making it, reaching about 300% efficiency even in the cold.

## What is a heat pump?

A heat pump moves heat, achieving 300% efficiency. According to the DOE it holds capacity to 5F.
`;

describe("estimateRescore", () => {
  it("is pure and synchronous — identical input yields identical output", () => {
    const rub = fixedRub(70);
    const a = estimateRescore(WEAK_INTRO, rub);
    const b = estimateRescore(WEAK_INTRO, rub);
    expect(a).toEqual(b);
    // Returns a plain value, not a promise.
    expect(a).not.toBeInstanceOf(Promise);
  });

  it("bumps the AI Overview and AEO lenses when the intro is fixed", () => {
    // Strong RUB signals, so the weak intro's AI Overview is high enough to be
    // actively suppressed by the S1<30 hard cap (proving the cap, not just a low
    // raw score) — and the intro fix both lifts the cap and raises the lens.
    const rub = fixedRub(100);
    const weak = estimateRescore(WEAK_INTRO, rub);
    const fixed = estimateRescore(FIXED_INTRO, rub);

    // AI Overview weights S1 most heavily and hard-caps at 40 when S1 < 30.
    expect(weak.aiOverview.capped).toBe(true);
    expect(weak.aiOverview.score).toBe(40);
    expect(fixed.aiOverview.score).toBeGreaterThan(weak.aiOverview.score);
    expect(fixed.aiOverview.capped).toBe(false);

    // AEO also carries S1 weight, so it rises too.
    expect(fixed.aeo.score).toBeGreaterThan(weak.aeo.score);
  });

  it("recomputes the DET S1 signal from content but preserves the RUB signals", () => {
    const weak = blendBreakdown(WEAK_INTRO, false, {
      lenses: {
        aeo: { lens: "aeo", score: 0, capped: false },
        geo: { lens: "geo", score: 0, capped: false },
        citability: { lens: "citability", score: 0, capped: false },
        aiOverview: { lens: "aiOverview", score: 0, capped: false },
      },
      signals: {
        S1: { id: "S1", score: 0, detail: {} },
        S2: { id: "S2", score: 0, detail: {} },
        S3: { id: "S3", score: 0, detail: {} },
        S4: { id: "S4", score: 0, detail: {} },
        S5: { id: "S5", score: 0, detail: {} },
        S6: { id: "S6", score: 0, detail: {} },
        S7: { id: "S7", score: 0, detail: {} },
        S8: { id: "S8", score: 0, detail: {} },
        S9: { id: "S9", score: 0, detail: {} },
        S10: { id: "S10", score: 0, detail: {} },
        S11: { id: "S11", score: 0, detail: {} },
        ...fixedRub(85),
      },
      rubricVersion: "test",
      signalsVersion: "test",
      modelId: "mock",
    });
    const fixed = blendBreakdown(FIXED_INTRO, false, weak);

    // DET half is recomputed from the edited content: S1 rises.
    expect(fixed.signals.S1.score).toBeGreaterThan(weak.signals.S1.score);
    // RUB half is carried over unchanged (still the last true audit's values).
    for (const id of RUB_SIGNAL_IDS) {
      expect(fixed.signals[id].score).toBe(85);
    }
  });
});
