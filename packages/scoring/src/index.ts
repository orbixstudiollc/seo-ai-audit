/** Public entry point for @aeo/scoring. Import the package's stable API from here. */

export type {
  ParsedDocument,
  SignalId,
  DetSignalId,
  RubSignalId,
  QuantizedScore,
  DetSignalResult,
  RubSignalResult,
  SignalResult,
  Lens,
  LensScore,
  ScoreBreakdown,
  AnchorSuggestion,
  AiOverviewBlocker,
  RubricYields,
  AuditResult,
} from "./types";
export { SIGNAL_IDS, DET_SIGNAL_IDS, RUB_SIGNAL_IDS, LENSES } from "./types";

// canonicalize + blockNodesToText are surfaced so the app layer can compute a
// content-only hash (audits.content_hash) with the exact same normalization the
// cache key uses, and extract a heading section's text for JSON-LD, without
// re-implementing either (or importing @types/mdast directly).
export { computeParsedDocument, canonicalize, blockNodesToText } from "./parse";
export { DET_SIGNALS } from "./signals/det";
// LENS_WEIGHTS plus the two functions that consume it. Exported so the client
// isomorphic re-score (app/hooks/useDetRescore.ts) blends signals with the
// exact same weighting + hard-cap math the server pipeline uses, instead of
// forking the weight numbers or re-deriving the cap thresholds.
export { LENS_WEIGHTS, computeLensScore, applyHardCaps } from "./weights";
export { RUBRIC_VERSION } from "./rubricPrompt";
export { runAudit, SIGNALS_VERSION } from "./pipeline";
export type { RunAuditInput } from "./pipeline";
export { generateValidatedObject, isStructuredOutputCapabilityError } from "./generateValidatedObject";
export { cacheKey } from "./cache";
