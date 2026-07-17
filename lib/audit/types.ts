import type {
  DetSignalId,
  DetSignalResult,
  Lens,
  RubSignalResult,
  ScoreBreakdown,
  SignalId,
} from "@aeo/scoring";

/**
 * App-layer audit contracts shared by the /api/audit route (producer) and the
 * results UI's SSE consumer (WS3). This is the v1 anonymous shape — the exact
 * TypeScript source of truth for docs/DATA-CONTRACT.md. No persistence: every
 * type here describes one in-flight stream, not a stored row.
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

// --- Fetched-page metadata ---------------------------------------------------

/** Fetched-page metadata, the first event on every stream. */
export interface PageMeta {
  /** URL as submitted. */
  url: string;
  /** URL after redirects (≤3 hops), the one actually audited. */
  finalUrl: string;
  title: string;
  wordCount: number;
  /** ISO timestamp of the fetch. */
  fetchedAt: string;
}

// --- SSE stream envelope ----------------------------------------------------

/** Client-side lifecycle of one streamed audit run. */
export type AuditStreamPhase = "idle" | "connecting" | "streaming" | "done" | "error";

/** v1 anonymous error kinds. */
export type AuditErrorKind =
  | "invalid_url" // failed validation after stream start (rare)
  | "fetch_failed" // network error, non-2xx, timeout, SSRF-blocked
  | "unsupported_content" // non-HTML, no extractable article, too large
  | "rate_limit" // per-IP bucket exhausted; retryAfter set
  | "server"; // anything else (incl. LLM provider failures)

export type AuditStreamEvent =
  | { type: "meta"; page: PageMeta }
  | { type: "signals"; signals: Record<DetSignalId, DetSignalResult> }
  | { type: "scores"; scores: ScoreBreakdown; findings: AuditFindings }
  | { type: "rewrites"; rewrites: AuditRewrites }
  | { type: "done" }
  | { type: "error"; kind: AuditErrorKind; message: string; retryAfter?: number };

// --- Client-side assembled report (DATA-CONTRACT §4) -------------------------

/** Everything the results page holds once the stream completes. */
export interface AuditReport {
  page: PageMeta;
  scores: ScoreBreakdown;
  findings: AuditFindings;
  /** null until the `rewrites` event lands. */
  rewrites: AuditRewrites | null;
}

// Re-exported for consumers that only import from this module.
export type { Lens, ScoreBreakdown, SignalId, DetSignalResult, RubSignalResult };
