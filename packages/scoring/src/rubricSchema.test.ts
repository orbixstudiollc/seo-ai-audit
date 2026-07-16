import { describe, expect, it } from "vitest";
import { RUB_SIGNAL_IDS } from "./types";
import { clampAndQuantizeScore, rubricSchema, type RubricOutput } from "./rubricSchema";

function validRubricSample(): RubricOutput {
  return {
    S12: { score: 80, evidence: "Direct answer sentence." },
    S13: { score: 70, evidence: "Covers most questions.", questionGaps: ["What does X cost?"] },
    S14: {
      score: 60,
      evidence: null,
      anchorSuggestions: [{ claim: "X grew 40% in 2024.", suggestedSourceType: "primary_data" }],
    },
    S15: { score: 55, evidence: "Original benchmark data included." },
    S16: { score: 65, evidence: "X is defined as Y." },
    S17: { score: 50, evidence: "We tested this for six months." },
    S18: { score: 90, evidence: null, blockers: [] },
  };
}

describe("clampAndQuantizeScore", () => {
  it("clamps values below 0 up to the floor", () => {
    // Arrange
    const input = -15;
    // Act
    const result = clampAndQuantizeScore(input);
    // Assert
    expect(result).toBe(0);
  });

  it("clamps values above 100 down to the ceiling", () => {
    const result = clampAndQuantizeScore(140);
    expect(result).toBe(100);
  });

  it("rounds to the nearest multiple of 5", () => {
    expect(clampAndQuantizeScore(42)).toBe(40);
    expect(clampAndQuantizeScore(43)).toBe(45);
  });

  it("passes exact multiples of 5 through unchanged", () => {
    expect(clampAndQuantizeScore(65)).toBe(65);
  });

  it("defaults non-finite input to the conservative floor", () => {
    expect(clampAndQuantizeScore(NaN)).toBe(0);
    expect(clampAndQuantizeScore(Infinity)).toBe(0);
    expect(clampAndQuantizeScore(-Infinity)).toBe(0);
  });
});

describe("rubricSchema", () => {
  it("accepts a fully valid rubric output", () => {
    const result = rubricSchema.safeParse(validRubricSample());
    expect(result.success).toBe(true);
  });

  it("exposes exactly the 7 RUB signal ids as top-level keys, in sync with types.ts", () => {
    expect(Object.keys(rubricSchema.shape).sort()).toEqual([...RUB_SIGNAL_IDS].sort());
  });

  it("accepts null evidence (quote-or-default)", () => {
    const sample = validRubricSample();
    const withNullEvidence = { ...sample, S12: { ...sample.S12, evidence: null } };

    expect(rubricSchema.safeParse(withNullEvidence).success).toBe(true);
  });

  it("rejects an object missing a required field", () => {
    const sample = validRubricSample();
    const broken: Record<string, unknown> = { ...sample, S12: { score: sample.S12.score } };

    expect(rubricSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects questionGaps beyond the max(8) bound", () => {
    const sample = validRubricSample();
    const broken = {
      ...sample,
      S13: { ...sample.S13, questionGaps: Array.from({ length: 9 }, (_, i) => `Question ${i}?`) },
    };

    expect(rubricSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects blockers beyond the max(6) bound", () => {
    const sample = validRubricSample();
    const tooManyBlockers = Array.from({ length: 7 }, (_, i) => ({ issue: `issue ${i}`, location: "intro" }));
    const broken = { ...sample, S18: { ...sample.S18, blockers: tooManyBlockers } };

    expect(rubricSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an unknown suggestedSourceType", () => {
    const sample = validRubricSample();
    const broken = {
      ...sample,
      S14: {
        ...sample.S14,
        anchorSuggestions: [{ claim: "X", suggestedSourceType: "made_up_type" }],
      },
    };

    expect(rubricSchema.safeParse(broken).success).toBe(false);
  });
});
