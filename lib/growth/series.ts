import type { GrowthSnapshot } from "./types";

/**
 * Pure §13 series → sparkline helpers (no React, no fetch — unit-tested).
 * A day's overall score prefers the lens blend (available after the site's
 * first full audit) and falls back to the DET-only average; err days carry
 * no data and are dropped from the sparkline series.
 */

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** Overall score for one snapshot day; null when the day has no data (err). */
export function snapshotScore(snapshot: GrowthSnapshot): number | null {
  if (snapshot.lens) return average(Object.values(snapshot.lens));
  if (snapshot.det) return average(Object.values(snapshot.det));
  return null;
}

/** Chronological sparkline input: one score per day with data. */
export function seriesScores(series: readonly GrowthSnapshot[]): number[] {
  return series.map(snapshotScore).filter((score): score is number => score !== null);
}
