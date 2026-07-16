import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModel } from "ai";
import type { RubricOutput } from "./rubricSchema";

/**
 * Builds a `LanguageModel` that deterministically returns `fixedResponse`
 * for every `generateObject`/`streamObject` call, with zero network access
 * and zero cost. This is the mocking seam the SQA review demanded (plan
 * amendment #8): it lets `runAudit` — and later, app-layer E2E tests — run
 * fully offline against a fixed, schema-valid structured-object response.
 *
 * `generateObject` extracts the object from the model's text content part
 * and validates it against `rubricSchema`, so returning
 * `JSON.stringify(fixedResponse)` as a single text part is sufficient; the
 * mock doesn't need to understand `responseFormat`/tool-calling at all.
 */
export function buildMockLanguageModel(fixedResponse: RubricOutput, modelId = "mock-rubric-model"): LanguageModel {
  return new MockLanguageModelV4({
    modelId,
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(fixedResponse) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 0, text: 0, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}
