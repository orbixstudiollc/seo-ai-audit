import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModel } from "ai";
import type { Tier } from "./provider";
import { E2E_INTRO_AFTER, E2E_WEAK_INTRO } from "./e2eFixture";

/**
 * E2E-only deterministic LLM mock for the audit pipeline. Activated by
 * AUDIT_TEST_MOCK=1 (set only by the Playwright dev server); `buildByokModel`
 * returns one of these instead of a real @ai-sdk provider, so the browser e2e
 * runs the whole two-call pipeline offline, at zero cost, with no provider key.
 *
 * This is the app-layer sibling of packages/scoring/src/testModel.ts's
 * `buildMockLanguageModel`: same MockLanguageModelV4 seam, but it also serves
 * call 2 (the rewrite generator, whose schema differs from the RUB rubric).
 *
 * The fixture (lib/audit/e2eFixture.ts) is deliberately identical in shape to the
 * headless journey (test/integration/workbenchJourney.test.ts): a weak,
 * fluff-opener intro that scores low on S1, so accepting the answer-first rewrite
 * measurably lifts the AI Overview / AEO lenses — the estimated-re-score
 * "dopamine loop" the e2e asserts moves the score bar.
 */

// Call 1 (RUB rubric) response — same schema-valid shape the unit suites use.
// The yields are coherent with E2E_ARTICLE (a real gap, a real unsourced claim,
// the weak intro as the blocker) so the findings drawer renders believable
// blocker/gap items alongside the computed weak-signal items.
const RUBRIC_RESPONSE = {
  S12: { score: 70, evidence: "A direct answer sentence lifted verbatim." },
  S13: {
    score: 70,
    evidence: "Covers the expected questions.",
    questionGaps: ["How long does a heat pump last?"],
  },
  S14: {
    score: 70,
    evidence: null,
    anchorSuggestions: [
      { claim: "A typical install runs $4,000 to $8,000", suggestedSourceType: "primary_data" },
    ],
  },
  S15: { score: 70, evidence: "Includes original benchmark data." },
  S16: { score: 70, evidence: "The key term is defined as X." },
  S17: { score: 70, evidence: "We ran this in production for six months." },
  S18: {
    score: 70,
    evidence: null,
    blockers: [{ issue: "Fluff opener buries the answer", location: "opening paragraph" }],
  },
};

// Call 2 (rewrite generator) response. `before` matches E2E_WEAK_INTRO verbatim
// so the workbench's accept path can apply the hunk to the working document.
const REWRITE_RESPONSE = {
  introRewrite: {
    before: E2E_WEAK_INTRO,
    after: E2E_INTRO_AFTER,
    rationale: "States the answer in sentence one, no fluff opener.",
  },
  sectionRewrites: [],
  quotableRewrites: [],
};

/** A model that returns `object` (serialized) for every structured-output call. */
function fixedModel(object: unknown, modelId: string): LanguageModel {
  return new MockLanguageModelV4({
    modelId,
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(object) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 0, text: 0, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

/** The mock model for a pipeline tier: the RUB rubric (cheap) or the rewrite generator (strong). */
export function e2eMockModel(tier: Tier): LanguageModel {
  return tier === "cheap"
    ? fixedModel(RUBRIC_RESPONSE, "gpt-5-mini")
    : fixedModel(REWRITE_RESPONSE, "gpt-5");
}
