import { generateObject, generateText, type LanguageModel } from "ai";
import type { z } from "zod";

type ProviderError = { statusCode?: unknown; name?: unknown; message?: unknown };

export function isStructuredOutputCapabilityError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as ProviderError;
  const status = typeof candidate.statusCode === "number" ? candidate.statusCode : null;
  if (status === 400 || status === 404 || status === 422) return true;
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  return /NoObjectGenerated|No object generated|structured output|tool.?use|tool.?choice|response.?format/i.test(`${name} ${message}`);
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("The provider fallback did not return a JSON object.");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export interface GenerateValidatedObjectInput<T> {
  model: LanguageModel;
  schema: z.ZodType<T>;
  prompt: string;
  temperature: number;
  abortSignal?: AbortSignal;
}

/**
 * Prefer the AI SDK's native structured output. If a compatible proxy rejects
 * that capability, retry once as plain text and validate the JSON locally with
 * the exact same schema. Credential, rate-limit, and server errors are never
 * retried, avoiding duplicate spend and hiding operational failures.
 */
export async function generateValidatedObject<T>(input: GenerateValidatedObjectInput<T>) {
  try {
    return await generateObject(input);
  } catch (error) {
    if (!isStructuredOutputCapabilityError(error)) throw error;
    const fallback = await generateText({
      model: input.model,
      prompt: `${input.prompt}\n\nThe provider cannot enforce a response schema. Return exactly one valid JSON object and no markdown fence or commentary.`,
      temperature: input.temperature,
      abortSignal: input.abortSignal,
    });
    const object = input.schema.parse(extractJson(fallback.text));
    return { object, response: fallback.response, usage: fallback.usage, warnings: fallback.warnings };
  }
}
