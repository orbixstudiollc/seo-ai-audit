import { describe, expect, it } from "vitest";
import { runAudit } from "./pipeline";
import { buildMockLanguageModel } from "./testModel";
import type { RubricOutput } from "./rubricSchema";

const CONTENT = `# What is a heat pump?

A heat pump moves heat rather than making it, reaching about 300% efficiency.

## What does a heat pump cost?

A typical install runs $4,000 to $8,000, and rebates cover up to $2,000.
`;

const RUBRIC_FIXTURE: RubricOutput = {
  S12: { score: 70, evidence: "A direct answer sentence lifted verbatim." },
  S13: {
    score: 55,
    evidence: "Covers cost and mechanism.",
    questionGaps: ["How long does a heat pump last?"],
  },
  S14: {
    score: 60,
    evidence: null,
    anchorSuggestions: [
      { claim: "A typical install runs $4,000 to $8,000", suggestedSourceType: "primary_data" },
    ],
  },
  S15: { score: 70, evidence: "Includes original benchmark data." },
  S16: { score: 70, evidence: "The key term is defined as X." },
  S17: { score: 70, evidence: "We ran this in production for six months." },
  S18: {
    score: 45,
    evidence: null,
    blockers: [{ issue: "answer buried in paragraph 3", location: "opening paragraph" }],
  },
};

describe("runAudit yields", () => {
  it("surfaces question gaps, anchor suggestions, and blockers from the rubric call", async () => {
    const model = buildMockLanguageModel(RUBRIC_FIXTURE);
    const result = await runAudit({ content: CONTENT, isHtml: false, model });

    expect(result.yields).toEqual({
      questionGaps: ["How long does a heat pump last?"],
      anchorSuggestions: [
        { claim: "A typical install runs $4,000 to $8,000", suggestedSourceType: "primary_data" },
      ],
      blockers: [{ issue: "answer buried in paragraph 3", location: "opening paragraph" }],
    });
  });

  it("keeps yields additive: the ScoreBreakdown fields are unchanged by their presence", async () => {
    const model = buildMockLanguageModel(RUBRIC_FIXTURE);
    const result = await runAudit({ content: CONTENT, isHtml: false, model });

    // RUB scores still come from the rubric response, quantized as before.
    expect(result.signals.S13.score).toBe(55);
    expect(result.signals.S18.score).toBe(45);
    expect(result.rubricVersion).toBeTruthy();
    expect(result.signalsVersion).toBeTruthy();
    expect(result.modelId).toBe("mock-rubric-model");
  });
});
