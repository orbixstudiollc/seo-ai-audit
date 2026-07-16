/**
 * The red -> amber -> green score scale, with a non-color redundant cue.
 *
 * Every band carries a distinct GLYPH (triangle-down / square / triangle-up)
 * and a text LABEL in addition to color, so the scale stays legible for
 * colorblind users and in monochrome. UI must render the glyph and/or label
 * alongside the color — never the color alone.
 */

export type ScoreBand = "weak" | "mid" | "strong" | "empty";

export interface ScoreBandInfo {
  band: ScoreBand;
  /** Human label — the primary non-color cue. */
  label: string;
  /** Distinct shape per band — the secondary non-color cue. */
  glyph: string;
  /** CSS var reference for the band's ink color. */
  colorVar: string;
  /** CSS var reference for the band's tint (background) color. */
  tintVar: string;
}

const WEAK_CEIL = 40; // < 40 -> at risk
const STRONG_FLOOR = 70; // >= 70 -> strong

const BANDS: Record<ScoreBand, ScoreBandInfo> = {
  weak: {
    band: "weak",
    label: "At risk",
    glyph: "▼",
    colorVar: "var(--score-weak)",
    tintVar: "var(--score-weak-tint)",
  },
  mid: {
    band: "mid",
    label: "Needs work",
    glyph: "■",
    colorVar: "var(--score-mid)",
    tintVar: "var(--score-mid-tint)",
  },
  strong: {
    band: "strong",
    label: "Strong",
    glyph: "▲",
    colorVar: "var(--score-strong)",
    tintVar: "var(--score-strong-tint)",
  },
  empty: {
    band: "empty",
    label: "Not scored",
    glyph: "–",
    colorVar: "var(--score-empty)",
    tintVar: "var(--surface-2)",
  },
};

export function scoreBand(value: number | null): ScoreBandInfo {
  if (value === null || Number.isNaN(value)) return BANDS.empty;
  if (value < WEAK_CEIL) return BANDS.weak;
  if (value < STRONG_FLOOR) return BANDS.mid;
  return BANDS.strong;
}
