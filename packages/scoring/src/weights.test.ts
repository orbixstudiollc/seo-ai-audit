import { describe, expect, it } from "vitest";
import { DET_SIGNAL_IDS, LENSES, SIGNAL_IDS } from "./types";
import type { DetSignalId, RubSignalId, SignalId, SignalResult } from "./types";
import { applyHardCaps, computeLensScore, LENS_WEIGHTS } from "./weights";

const DET_ID_SET = new Set<SignalId>(DET_SIGNAL_IDS);

/** Builds a full 18-signal record, defaulting every score to 100 except overrides. */
function makeSignals(overrides: Partial<Record<SignalId, number>> = {}): Record<SignalId, SignalResult> {
  const signals = {} as Record<SignalId, SignalResult>;
  for (const id of SIGNAL_IDS) {
    const score = overrides[id] ?? 100;
    signals[id] = DET_ID_SET.has(id)
      ? { id: id as DetSignalId, score, detail: {} }
      : { id: id as RubSignalId, score, evidence: null };
  }
  return signals;
}

describe("LENS_WEIGHTS", () => {
  it("sums to exactly 100 for every lens", () => {
    for (const lens of LENSES) {
      const total = Object.values(LENS_WEIGHTS[lens]).reduce((a, b) => a + b, 0);
      expect(total).toBe(100);
    }
  });
});

describe("computeLensScore", () => {
  it("returns 100 for every lens when all contributing signals score 100", () => {
    const signals = makeSignals();
    for (const lens of LENSES) {
      const result = computeLensScore(lens, signals);
      expect(result.score).toBe(100);
      expect(result.capped).toBe(false);
    }
  });

  it("computes a weighted average and quantizes to the nearest 5", () => {
    // aeo: S1 weight 10 drops from 100 -> 0, rest stay 100.
    // weightedSum = 100*100 - 10*100 = 9000; /100 = 90 (already on-grid).
    const signals = makeSignals({ S1: 0 });
    expect(computeLensScore("aeo", signals).score).toBe(90);
  });

  it("ignores signals that don't contribute to the lens", () => {
    // S18 has weight 0 everywhere; tanking it must not move any lens score.
    const baseline = computeLensScore("geo", makeSignals());
    const withS18Zeroed = computeLensScore("geo", makeSignals({ S18: 0 }));
    expect(withS18Zeroed.score).toBe(baseline.score);
  });
});

describe("applyHardCaps", () => {
  function scoreAllLenses(signals: Record<SignalId, SignalResult>) {
    return {
      aeo: computeLensScore("aeo", signals),
      geo: computeLensScore("geo", signals),
      citability: computeLensScore("citability", signals),
      aiOverview: computeLensScore("aiOverview", signals),
    };
  }

  it("caps aiOverview at 40 when S1 < 30", () => {
    const signals = makeSignals({ S1: 0 });
    const capped = applyHardCaps(scoreAllLenses(signals), signals);
    expect(capped.aiOverview.score).toBe(40);
    expect(capped.aiOverview.capped).toBe(true);
    expect(capped.aiOverview.capReason).toBeTruthy();
  });

  it("does not cap aiOverview when S1 >= 30", () => {
    const signals = makeSignals({ S1: 30 });
    const scores = scoreAllLenses(signals);
    const capped = applyHardCaps(scores, signals);
    expect(capped.aiOverview.capped).toBe(false);
    expect(capped.aiOverview.score).toBe(scores.aiOverview.score);
  });

  it("caps citability at 50 when both S8 and S9 are below 10", () => {
    const signals = makeSignals({ S8: 5, S9: 0 });
    const capped = applyHardCaps(scoreAllLenses(signals), signals);
    expect(capped.citability.score).toBe(50);
    expect(capped.citability.capped).toBe(true);
    expect(capped.citability.capReason).toBeTruthy();
  });

  it("does not cap citability when only one of S8/S9 is below 10", () => {
    const signals = makeSignals({ S8: 5, S9: 100 });
    const scores = scoreAllLenses(signals);
    const capped = applyHardCaps(scores, signals);
    expect(capped.citability.capped).toBe(false);
    expect(capped.citability.score).toBe(scores.citability.score);
  });

  it("does not mark capped when the raw score is already at or under the cap", () => {
    // Every signal at 0 drives every lens to 0, well under either cap.
    const signals = makeSignals({});
    for (const id of SIGNAL_IDS) {
      signals[id] = { ...signals[id], score: 0 } as SignalResult;
    }
    const capped = applyHardCaps(scoreAllLenses(signals), signals);
    expect(capped.aiOverview.capped).toBe(false);
    expect(capped.citability.capped).toBe(false);
  });

  it("does not mutate the input scores object", () => {
    const signals = makeSignals({ S1: 0 });
    const scores = scoreAllLenses(signals);
    const originalScore = scores.aiOverview.score;
    applyHardCaps(scores, signals);
    expect(scores.aiOverview.score).toBe(originalScore);
    expect(scores.aiOverview.capped).toBe(false);
  });
});
