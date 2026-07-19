import type { LanguageModel } from "ai";
import { computeParsedDocument } from "./parse";
import { DET_SIGNALS } from "./signals/det";
import { RUBRIC_VERSION, buildRubricPrompt } from "./rubricPrompt";
import { clampAndQuantizeScore, rubricSchema } from "./rubricSchema";
import { applyHardCaps, computeLensScore } from "./weights";
import { DET_SIGNAL_IDS, LENSES, RUB_SIGNAL_IDS } from "./types";
import type {
  AuditResult,
  Lens,
  LensScore,
  RubricYields,
  RubSignalResult,
  SignalId,
  SignalResult,
} from "./types";
import { generateValidatedObject } from "./generateValidatedObject";

/**
 * Bumped whenever DET signal logic or lens weighting changes in a way that
 * could shift scores. Stamped on every audit (see ScoreBreakdown.signalsVersion),
 * independent of RUBRIC_VERSION (rubricPrompt.ts) since the two halves of the
 * pipeline can change on different schedules.
 */
export const SIGNALS_VERSION = "v1.0.0";

export interface RunAuditInput {
  /** Raw article content: markdown for pasted input, HTML for a fetched page. */
  content: string;
  isHtml: boolean;
  /**
   * The language model backing the one RUB rubric call. Callers inject a
   * real @ai-sdk/openai or @ai-sdk/anthropic model, or a mock built with
   * `buildMockLanguageModel` (see testModel.ts) — runAudit never constructs
   * its own provider client, so it stays provider-agnostic and mockable.
   */
  model: LanguageModel;
}

/**
 * Runs the full audit pipeline: all 11 DET signals (free, instant, pure
 * TypeScript) plus exactly one LLM call for the 7 RUB signals, merged into a
 * complete `ScoreBreakdown` with all 4 lens scores and hard caps applied —
 * plus the rubric call's non-score `yields` (question gaps, anchor
 * suggestions, AI Overview blockers), which the app layer turns into findings.
 *
 * This is "call 1" of the plan's 2-call pipeline (structured rubric scoring,
 * temperature 0). Call 2 — generating the answer-first intro rewrite and
 * before/after section rewrites with a strong-tier model — is OUT OF SCOPE
 * for this package; it lives in app/api/audit/route.ts, which calls this
 * function first and then runs its own generation step against the
 * returned ScoreBreakdown.
 */
export async function runAudit(input: RunAuditInput): Promise<AuditResult> {
  const doc = computeParsedDocument(input.content, input.isHtml);

  const detSignals = DET_SIGNAL_IDS.map((id) => [id, DET_SIGNALS[id](doc)] as const);

  const { object: rubric, response } = await generateValidatedObject({
    model: input.model,
    schema: rubricSchema,
    prompt: buildRubricPrompt(doc, { rubricVersion: RUBRIC_VERSION }),
    temperature: 0,
  });

  const rubSignals = RUB_SIGNAL_IDS.map((id) => {
    const raw = rubric[id];
    const result: RubSignalResult = {
      id,
      score: clampAndQuantizeScore(raw.score),
      evidence: raw.evidence,
    };
    return [id, result] as const;
  });

  const signals = Object.fromEntries([...detSignals, ...rubSignals]) as Record<SignalId, SignalResult>;

  const rawLensScores = Object.fromEntries(
    LENSES.map((lens) => [lens, computeLensScore(lens, signals)]),
  ) as Record<Lens, LensScore>;
  const lenses = applyHardCaps(rawLensScores, signals);

  // Schema-validated (bounded .max arrays, required by rubricSchema), so these
  // are safe to pass through verbatim — no clamping or defaulting needed.
  const yields: RubricYields = {
    questionGaps: rubric.S13.questionGaps,
    anchorSuggestions: rubric.S14.anchorSuggestions,
    blockers: rubric.S18.blockers,
  };

  return {
    lenses,
    signals,
    rubricVersion: RUBRIC_VERSION,
    signalsVersion: SIGNALS_VERSION,
    // Resolved by the AI SDK regardless of whether `model` was passed as a
    // string id or a model instance — always the concrete id that actually
    // produced this response (never module-level state).
    modelId: response.modelId,
    yields,
  };
}
