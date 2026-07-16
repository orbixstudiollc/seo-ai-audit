import type {
  DetSignalId,
  DetSignalResult,
  Lens,
  RubSignalResult,
  ScoreBreakdown,
  SignalId,
} from "@aeo/scoring";

/**
 * App-layer audit contracts shared across the workbench UI, the SSE consumer
 * hook, and the (sibling-owned) /api/audit route. The scoring engine returns a
 * ScoreBreakdown (scores only); everything below — findings, rewrites, the
 * stream envelope — is app-layer data the route derives from call 1 / call 2
 * and persists to the `audits` table's jsonb columns.
 */

// --- Findings (derived from LLM call 1 / the RUB rubric) --------------------

export interface AnchorSuggestion {
  claim: string;
  suggestedSourceType: string;
}

export interface AiOverviewBlocker {
  issue: string;
  location: string;
}

export interface QaPair {
  question: string;
  answer: string;
}

export interface AuditFindings {
  /** Missing PAA-style questions a thorough article should answer (S13). */
  questionGaps: string[];
  /** Claims lacking a checkable source (S14). */
  anchorSuggestions: AnchorSuggestion[];
  /** What is stopping an AI Overview from citing this page (S18). */
  blockers: AiOverviewBlocker[];
  /** Extracted Q/A pairs — the source for templated FAQ JSON-LD. */
  qaPairs: QaPair[];
  /** Liftable, self-contained quotable sentences. */
  quotables: string[];
}

// --- Rewrites (derived from LLM call 2 / the generator) ---------------------

export type RewriteKind = "intro" | "section" | "quotable";

export interface RewriteHunk {
  id: string;
  kind: RewriteKind;
  /** Heading text, or a label like "Answer-first intro". */
  label: string;
  before: string;
  after: string;
  /** The signal this rewrite is intended to move, for provenance in the UI. */
  targetSignal?: SignalId;
}

export interface AuditRewrites {
  hunks: RewriteHunk[];
}

// --- What the server component hands the client workbench -------------------

export interface WorkbenchDocument {
  id: string;
  title: string;
  source: "paste" | "url";
  sourceUrl: string | null;
  rawContent: string;
  wordCount: number;
}

export type AuditPhaseStatus = "pending" | "done" | "failed";

export interface WorkbenchAudit {
  id: string;
  status: "running" | "completed" | "failed";
  scoresStatus: AuditPhaseStatus;
  rewritesStatus: AuditPhaseStatus;
  scores: ScoreBreakdown | null;
  findings: AuditFindings | null;
  rewrites: AuditRewrites | null;
  modelId: string;
  createdAt: string;
  /** Persisted failure reason (audits.error). Populated by the recovery read
   *  (getAuditStatus) so a resumed client surfaces the user-friendly provider
   *  message instead of a generic failure. */
  error?: string | null;
}

// --- SSE stream envelope ----------------------------------------------------

export type AuditErrorKind =
  | "no_key"
  | "invalid_key"
  | "rate_limit"
  | "quota"
  | "auth"
  | "already_running"
  | "server";

export type AuditStreamEvent =
  | { type: "signals"; signals: Record<DetSignalId, DetSignalResult> }
  | { type: "scores"; scores: ScoreBreakdown; findings: AuditFindings }
  | { type: "rewrites"; rewrites: AuditRewrites }
  | { type: "done"; auditId: string }
  | { type: "error"; kind: AuditErrorKind; message: string; retryAfter?: number };

// Re-exported for consumers that only import from this module.
export type { Lens, ScoreBreakdown, SignalId, DetSignalResult, RubSignalResult };
