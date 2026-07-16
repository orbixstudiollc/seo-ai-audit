import type { Root } from "mdast";

/** Parsed markdown ready for signal extraction. Built once per audit, shared by all signals. */
export interface ParsedDocument {
  raw: string;
  ast: Root;
  plainText: string;
  wordCount: number;
  headings: Array<{ depth: number; text: string; index: number }>;
  hasJsonLd: boolean;
}

export const SIGNAL_IDS = [
  "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11",
  "S12", "S13", "S14", "S15", "S16", "S17", "S18",
] as const;

export type SignalId = (typeof SIGNAL_IDS)[number];

export const DET_SIGNAL_IDS = [
  "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11",
] as const satisfies readonly SignalId[];

export const RUB_SIGNAL_IDS = [
  "S12", "S13", "S14", "S15", "S16", "S17", "S18",
] as const satisfies readonly SignalId[];

export type DetSignalId = (typeof DET_SIGNAL_IDS)[number];
export type RubSignalId = (typeof RUB_SIGNAL_IDS)[number];

/** 0-100, quantized to steps of 5 before storage. */
export type QuantizedScore = number;

export interface DetSignalResult {
  id: DetSignalId;
  score: QuantizedScore;
  /** Raw measurement backing the score, e.g. { pct: 0.42, count: 5 } — for the "why 61" breakdown UI. */
  detail: Record<string, number | string | boolean>;
}

export interface RubSignalResult {
  id: RubSignalId;
  score: QuantizedScore;
  /** Verbatim quote from the source content justifying the score. Required — no quote, no score above the conservative default. */
  evidence: string | null;
}

export type SignalResult = DetSignalResult | RubSignalResult;

export const LENSES = ["aeo", "geo", "citability", "aiOverview"] as const;
export type Lens = (typeof LENSES)[number];

export interface LensScore {
  lens: Lens;
  score: QuantizedScore;
  /** True when a hard cap suppressed the raw weighted score. */
  capped: boolean;
  capReason?: string;
}

export interface ScoreBreakdown {
  lenses: Record<Lens, LensScore>;
  signals: Record<SignalId, SignalResult>;
  rubricVersion: string;
  signalsVersion: string;
  modelId: string;
}

/** A claim lacking a checkable source, plus the source category that would fix it (S14 yield). */
export interface AnchorSuggestion {
  claim: string;
  suggestedSourceType: string;
}

/** A specific thing stopping an AI Overview from citing the page (S18 yield). */
export interface AiOverviewBlocker {
  issue: string;
  location: string;
}

/**
 * Non-score artifacts the single rubric call also yields: the bounded arrays
 * S13/S14/S18 emit alongside their scores. Additive to ScoreBreakdown — they
 * never influence scoring, so surfacing them does not touch RUBRIC_VERSION.
 */
export interface RubricYields {
  questionGaps: string[];
  anchorSuggestions: AnchorSuggestion[];
  blockers: AiOverviewBlocker[];
}

/** Everything one audit run produces: the ScoreBreakdown plus the rubric call's yields. */
export interface AuditResult extends ScoreBreakdown {
  yields: RubricYields;
}
