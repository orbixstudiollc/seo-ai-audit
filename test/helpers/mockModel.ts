import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModel } from "ai";

/**
 * Zero-cost, zero-network language-model mocks for the audit-pipeline suites —
 * the same MockLanguageModelV4 seam that `buildMockLanguageModel` in
 * packages/scoring/src/testModel.ts wraps. Nothing here ever reaches a real
 * provider. This variant adds three affordances the plain wrapper does not:
 *
 *   - a live call count (via the model's own `doGenerateCalls`), for asserting
 *     "exactly one LLM call" on the idempotency / cache-hit paths;
 *   - an optional `gate` promise the model awaits before resolving, so a request
 *     can be held mid-flight while a second concurrent request is driven;
 *   - an optional `fail` error the model throws, to drive the call-2 partial
 *     failure path.
 */

interface TextResult {
  content: { type: "text"; text: string }[];
  finishReason: { unified: "stop"; raw: string };
  usage: {
    inputTokens: { total: number; noCache: number; cacheRead: undefined; cacheWrite: undefined };
    outputTokens: { total: number; text: number; reasoning: undefined };
  };
  warnings: [];
}

/** Shape a structured object into the single-text-part generate result generateObject expects. */
function textResult(object: unknown): TextResult {
  return {
    content: [{ type: "text", text: JSON.stringify(object) }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 0, text: 0, reasoning: undefined },
    },
    warnings: [],
  };
}

export interface Deferred<T = void> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export interface ScriptModelOptions {
  modelId?: string;
  /** Held until resolved; lets a caller keep a request in-flight (default: resolves immediately). */
  gate?: Promise<void>;
  /** When set, doGenerate throws this instead of returning — drives failure paths. */
  fail?: Error;
}

export interface ScriptedModel {
  model: LanguageModel;
  /** Number of generateObject/doGenerate invocations observed so far. */
  callCount(): number;
}

/**
 * A model that returns `object` (serialized) for every structured-output call,
 * counting invocations and honouring an optional gate/failure.
 */
export function scriptModel(object: unknown, options: ScriptModelOptions = {}): ScriptedModel {
  const mock = new MockLanguageModelV4({
    modelId: options.modelId ?? "mock-model",
    doGenerate: async () => {
      if (options.gate) await options.gate;
      if (options.fail) throw options.fail;
      return textResult(object) as never;
    },
  });
  return {
    model: mock,
    callCount: () => mock.doGenerateCalls.length,
  };
}

// ---------------------------------------------------------------------------
// Schema-valid sample payloads
// ---------------------------------------------------------------------------

/** A fully schema-valid RUB rubric output (call 1). `score` pins every RUB signal. */
export function rubricResponse(score = 70) {
  return {
    S12: { score, evidence: "A direct answer sentence lifted verbatim." },
    S13: { score, evidence: "Covers the expected questions.", questionGaps: ["What does it cost?"] },
    S14: {
      score,
      evidence: null,
      anchorSuggestions: [{ claim: "Adoption grew 40% in 2024.", suggestedSourceType: "primary_data" }],
    },
    S15: { score, evidence: "Includes original benchmark data." },
    S16: { score, evidence: "The key term is defined as X." },
    S17: { score, evidence: "We ran this in production for six months." },
    S18: { score, evidence: null, blockers: [] },
  };
}

/** A schema-valid rewrite generator output (call 2). `introBefore` should match text in the audited doc. */
export function rewriteResponse(introBefore = "This is the current opening paragraph.") {
  return {
    introRewrite: {
      before: introBefore,
      after: "A heat pump moves heat rather than making it, reaching about 300% efficiency.",
      rationale: "States the answer in sentence one.",
    },
    sectionRewrites: [],
    quotableRewrites: [],
  };
}
