import type { Lens, LensScore, QuantizedScore, SignalId, SignalResult } from "./types";

/**
 * Contribution (out of 100) of each signal to each lens. A signal/lens pair
 * absent from a lens's map contributes 0 to that lens.
 *
 * Single source of truth for lens weighting: sum(LENS_WEIGHTS[lens]) === 100
 * for every lens. No other module may hardcode a weight number.
 */
export const LENS_WEIGHTS: Record<Lens, Partial<Record<SignalId, number>>> = {
  aeo: {
    S1: 10,
    S2: 10,
    S3: 15,
    S4: 10,
    S5: 5,
    S6: 5,
    S7: 10,
    S12: 20,
    S13: 15,
  },
  geo: {
    S4: 10,
    S8: 15,
    S9: 10,
    S10: 15,
    S11: 10,
    S14: 20,
    S15: 10,
    S16: 10,
  },
  citability: {
    S8: 20,
    S9: 15,
    S10: 15,
    S14: 25,
    S15: 15,
    S16: 10,
  },
  aiOverview: {
    S1: 25,
    S2: 10,
    S4: 15,
    S7: 10,
    S12: 25,
    S17: 15,
  },
};

const QUANTIZATION_STEP = 5;

function quantize(score: number): QuantizedScore {
  return Math.round(score / QUANTIZATION_STEP) * QUANTIZATION_STEP;
}

/**
 * Weighted sum of signal scores for one lens, divided by 100 and quantized
 * to the nearest 5. Weights always sum to 100, and signal scores are always
 * in [0, 100], so the result needs no separate clamping.
 */
export function computeLensScore(lens: Lens, signals: Record<SignalId, SignalResult>): LensScore {
  const weights = LENS_WEIGHTS[lens];
  const weightedSum = (Object.keys(weights) as SignalId[]).reduce(
    (sum, id) => sum + signals[id].score * (weights[id] ?? 0),
    0,
  );

  return { lens, score: quantize(weightedSum / 100), capped: false };
}

const AI_OVERVIEW_INTRO_THRESHOLD = 30;
const AI_OVERVIEW_CAP = 40;
const CITABILITY_EVIDENCE_THRESHOLD = 10;
const CITABILITY_CAP = 50;

/**
 * Deterministic ceilings applied after the weighted composite, so one badly
 * failing signal can't get diluted away by the rest of the lens.
 *
 * - AI Overview is capped at 40 when S1 (answer-first intro) scores below 30.
 * - Citability is capped at 50 when both S8 (stat/fact density) and S9
 *   (citation density) score below 10 — i.e. both effectively at or near
 *   zero on the 5-point quantization grid.
 *
 * `capped` is only set when the cap actually suppresses the raw score
 * (matches the `LensScore.capped` contract in types.ts); a lens already at
 * or under its cap threshold is left untouched.
 */
export function applyHardCaps(
  scores: Record<Lens, LensScore>,
  signals: Record<SignalId, SignalResult>,
): Record<Lens, LensScore> {
  const result = { ...scores };

  if (signals.S1.score < AI_OVERVIEW_INTRO_THRESHOLD && result.aiOverview.score > AI_OVERVIEW_CAP) {
    result.aiOverview = {
      ...result.aiOverview,
      score: AI_OVERVIEW_CAP,
      capped: true,
      capReason: "Your intro alone caps you: the answer-first intro signal (S1) scored below 30.",
    };
  }

  if (
    signals.S8.score < CITABILITY_EVIDENCE_THRESHOLD &&
    signals.S9.score < CITABILITY_EVIDENCE_THRESHOLD &&
    result.citability.score > CITABILITY_CAP
  ) {
    result.citability = {
      ...result.citability,
      score: CITABILITY_CAP,
      capped: true,
      capReason: "Stat/fact density (S8) and citation density (S9) are both near zero.",
    };
  }

  return result;
}
