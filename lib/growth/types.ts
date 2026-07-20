import type { DetSignalId, Lens } from "@aeo/scoring";

/**
 * DATA-CONTRACT §13 — growth-tracking shapes. Coordinator-owned (contract
 * home, like lib/audit/types.ts). g2-api produces these over the wire;
 * g2-ui consumes them (mock-first via lib/growth/mockSeries.ts).
 */

export interface TrackedSite {
  url: string;
  createdAt: string;
  lastRunAt: string | null;
}

/** One day of one tracked site. Compact: score-only, detail stripped. */
export interface GrowthSnapshot {
  /** captured_on, YYYY-MM-DD (UTC). */
  d: string;
  /** DET signal scores; null = fetch failed that day. */
  det: Record<DetSignalId, number> | null;
  /** estimateRescore blend; null before the site's first full audit. */
  lens: Record<Lens, number> | null;
  /** content_hash differs from the previous snapshot. */
  changed?: true;
  /** Fetch failed (details stay server-side in fetch_meta). */
  err?: true;
}

export interface GrowthSeries {
  url: string;
  signalsVersion: string;
  /** Oldest → newest, ≤ requested days, dates unique. */
  series: GrowthSnapshot[];
}
