import { z } from "zod";
import type { QuantizedScore, RubSignalId } from "./types";

/**
 * Zod schema for the RUB signal pool (S12-S18), targeted directly by `streamObject`.
 *
 * Cross-provider constraint (architecture review, vercel/ai#14342, vercel/ai#13355):
 * Anthropic's structured-output path 400s on `.min()/.max()/.int()` bounds compiling to
 * `exclusiveMinimum`/`exclusiveMaximum` JSON Schema keywords. So score fields are a plain
 * `z.number()` — the 0-100/step-5 contract is enforced by prompt instruction plus the
 * `clampAndQuantizeScore` post-hoc guard below, never by zod bounds.
 * ponytail: plain z.number() chosen over the z.enum('0'|'5'|...'100') alternative the task
 * allowed — same cross-provider safety, one line instead of a 21-member enum + transform.
 *
 * OpenAI strict structured-output mode requires every field present in `required`, so this
 * schema uses `.nullable()` everywhere a value can legitimately be absent instead of
 * `.optional()` — there is no `.optional()` anywhere below.
 */

const scoreSchema = z
  .number()
  .describe(
    "Integer 0-100, must be a multiple of 5. Calibrated per the signal's anchor table in the prompt — not a generic quality impression.",
  );

const evidenceSchema = z
  .string()
  .nullable()
  .describe(
    "A verbatim quote copy-pasted from the article that justifies this score, or null if no such passage exists (quote-or-default). Never paraphrased.",
  );

const rubSignalSchema = z.object({
  score: scoreSchema,
  evidence: evidenceSchema,
});

const questionGapSchema = z
  .string()
  .describe(
    "A specific, concrete question a thorough article on this exact topic should answer but this one does not.",
  );

const anchorSuggestionSchema = z.object({
  claim: z
    .string()
    .describe("A verbatim or near-verbatim claim from the article that currently lacks a checkable source."),
  suggestedSourceType: z
    .enum([
      "primary_data",
      "official_docs",
      "academic_study",
      "news_report",
      "expert_quote",
      "government_or_standards",
      "other",
    ])
    .describe("The category of source that would make this claim independently verifiable."),
});

const blockerSchema = z.object({
  issue: z
    .string()
    .describe(
      "Short label for the specific AI-Overview blocker, e.g. 'answer buried in paragraph 3' or 'opinion-framed opening sentence'.",
    ),
  location: z
    .string()
    .describe("Where this occurs — the nearest heading text, or a position description such as 'opening paragraph'."),
});

/**
 * `satisfies Record<RubSignalId, z.ZodTypeAny>` is a compile-time guard: if `RUB_SIGNAL_IDS`
 * in types.ts ever gains or loses a signal, this object literal fails to typecheck (missing
 * or excess key) rather than silently drifting out of sync with the type contract.
 */
const rubricShape = {
  S12: rubSignalSchema.describe(
    "Answer directness — does each question-style section answer its question in the first sentence, with no throat-clearing?",
  ),
  S13: rubSignalSchema
    .extend({
      questionGaps: z
        .array(questionGapSchema)
        .max(8)
        .describe("Missing PAA-style questions a thorough article on this topic should cover. Empty array if none."),
    })
    .describe("Question gap coverage — completeness against the questions a reader/searcher would expect answered."),
  S14: rubSignalSchema
    .extend({
      anchorSuggestions: z
        .array(anchorSuggestionSchema)
        .max(10)
        .describe(
          "Claims needing a source anchor to be checkable. Empty array if every claim is already sourced, checkable, or safely hedged.",
        ),
    })
    .describe("Claim verifiability — are claims sourced, checkable, and hallucination-safe?"),
  S15: rubSignalSchema.describe(
    "Information uniqueness — original insight/data/experience vs. commodity paraphrase of generic content on this topic.",
  ),
  S16: rubSignalSchema.describe(
    "Definitional/entity clarity — are key entities/terms defined unambiguously enough to be lifted verbatim as a correct answer?",
  ),
  S17: rubSignalSchema.describe(
    "E-E-A-T — experience, expertise, authoritativeness, and trust markers visible in the article's own text.",
  ),
  S18: rubSignalSchema
    .extend({
      blockers: z
        .array(blockerSchema)
        .max(6)
        .describe("Specific things stopping an AI Overview from citing this article. Empty array if none found."),
    })
    .describe(
      "AI Overview blockers — INVERTED signal: a HIGH score means FEW/no blockers were found, not that blockers are good.",
    ),
} satisfies Record<RubSignalId, z.ZodTypeAny>;

export const rubricSchema = z.object(rubricShape);

export type RubricOutput = z.infer<typeof rubricSchema>;

const QUANTIZE_STEP = 5;
const MIN_SCORE = 0;
const MAX_SCORE = 100;

/**
 * Runtime safety net behind the prompt's "multiple of 5, 0-100" instruction: clamps to range,
 * then rounds to the nearest step of 5. Also the last line of defense against a non-finite
 * score slipping through (defaults to the conservative floor, matching the rubric's own
 * anti-inflation stance: uncertain/invalid -> score low, never high).
 */
export function clampAndQuantizeScore(n: number): QuantizedScore {
  const safe = Number.isFinite(n) ? n : MIN_SCORE;
  const clamped = Math.min(MAX_SCORE, Math.max(MIN_SCORE, safe));
  return Math.round(clamped / QUANTIZE_STEP) * QUANTIZE_STEP;
}
