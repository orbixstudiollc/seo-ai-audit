import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { generateValidatedObject, isStructuredOutputCapabilityError } from "./generateValidatedObject";

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
};

describe("generateValidatedObject", () => {
  it("recognizes capability errors but not auth or rate limits", () => {
    expect(isStructuredOutputCapabilityError({ statusCode: 400 })).toBe(true);
    expect(isStructuredOutputCapabilityError(new Error("structured output unsupported"))).toBe(true);
    expect(isStructuredOutputCapabilityError({ statusCode: 401 })).toBe(false);
    expect(isStructuredOutputCapabilityError({ statusCode: 429 })).toBe(false);
  });

  it("falls back to plain JSON and validates it", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      modelId: "fallback-model",
      doGenerate: async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("tool_use unsupported"), { statusCode: 400 });
        return {
          content: [{ type: "text", text: "```json\n{\"score\": 72}\n```" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        };
      },
    });
    const result = await generateValidatedObject({
      model,
      schema: z.object({ score: z.number() }),
      prompt: "Return a score",
      temperature: 0,
    });
    expect(result.object).toEqual({ score: 72 });
    expect(calls).toBe(2);
  });

  it("does not retry authentication failures", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      modelId: "auth-model",
      doGenerate: async () => {
        calls += 1;
        throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
      },
    });
    await expect(generateValidatedObject({
      model,
      schema: z.object({ score: z.number() }),
      prompt: "Return a score",
      temperature: 0,
    })).rejects.toThrow("unauthorized");
    expect(calls).toBe(1);
  });
});
