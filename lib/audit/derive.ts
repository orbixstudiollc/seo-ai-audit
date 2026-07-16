import {
  applyHardCaps,
  computeLensScore,
  computeParsedDocument,
  DET_SIGNALS,
  DET_SIGNAL_IDS,
  LENSES,
  LENS_WEIGHTS,
  RUB_SIGNAL_IDS,
  type Lens,
  type LensScore,
  type RubSignalId,
  type RubSignalResult,
  type ScoreBreakdown,
  type SignalId,
  type SignalResult,
} from "@aeo/scoring";
import type { AuditFindings, AuditRewrites } from "./types";
import { SIGNAL_META } from "./signalMeta";

/**
 * Client-side estimated re-score. Recomputes the 11 DET signals from the
 * edited working document (free, instant, isomorphic) and re-blends them with
 * the last true RUB signals, reproducing the engine's four lens scores. This
 * is the instant "estimated" score jump when a user accepts a rewrite — the
 * true score still comes from re-running the one rubric call.
 *
 * The weighting and hard-cap math come straight from @aeo/scoring
 * (computeLensScore / applyHardCaps), the exact functions the server pipeline
 * uses, so the estimate can never drift from a true re-score. There are no
 * forked weight numbers or cap thresholds in this file.
 */

/** Fresh DET signals from the edited doc, merged with the last true RUB signals. */
function blendSignals(
  content: string,
  isHtml: boolean,
  rubSignals: Record<RubSignalId, RubSignalResult>,
): Record<SignalId, SignalResult> {
  const doc = computeParsedDocument(content, isHtml);
  const detEntries = DET_SIGNAL_IDS.map((id) => [id, DET_SIGNALS[id](doc)] as const);
  const rubEntries = RUB_SIGNAL_IDS.map((id) => [id, rubSignals[id]] as const);
  return Object.fromEntries([...detEntries, ...rubEntries]) as Record<SignalId, SignalResult>;
}

/** Lens scores + hard caps for a full signal set, via the engine's own math. */
function lensesFrom(signals: Record<SignalId, SignalResult>): Record<Lens, LensScore> {
  const raw = Object.fromEntries(
    LENSES.map((lens) => [lens, computeLensScore(lens, signals)]),
  ) as Record<Lens, LensScore>;
  return applyHardCaps(raw, signals);
}

/**
 * The four estimated lens scores after an edit — the score bars' new heights.
 * Pure and synchronous: accepting a rewrite calls this and the tiles move with
 * no network round-trip.
 */
export function estimateRescore(
  content: string,
  lastKnownRubSignals: Record<RubSignalId, RubSignalResult>,
  isHtml = false,
): Record<Lens, LensScore> {
  return lensesFrom(blendSignals(content, isHtml, lastKnownRubSignals));
}

/**
 * Same estimated re-score as `estimateRescore`, but returned as a full
 * ScoreBreakdown — DET signals refreshed, RUB signals and version stamps
 * carried over from `baseline`. For consumers that render the per-signal
 * breakdown, not just the four lens tiles.
 */
export function blendBreakdown(
  content: string,
  isHtml: boolean,
  baseline: ScoreBreakdown,
): ScoreBreakdown {
  const rubSignals = Object.fromEntries(
    RUB_SIGNAL_IDS.map((id) => [id, baseline.signals[id]]),
  ) as Record<RubSignalId, RubSignalResult>;
  const signals = blendSignals(content, isHtml, rubSignals);

  return {
    lenses: lensesFrom(signals),
    signals,
    rubricVersion: baseline.rubricVersion,
    signalsVersion: baseline.signalsVersion,
    modelId: baseline.modelId,
  };
}

// --- Rewrite hunk statuses ---------------------------------------------------

/**
 * Accept/reject statuses carried across a rewrites-payload change. Hunk ids
 * repeat across audits ("intro", "section-0", ... — see generator.ts), so
 * statuses keyed by hunk id are only valid for the exact payload they were set
 * against: any NEW payload (fresh audit, resumed row, cache-hit replay) starts
 * with every hunk unaccepted. Without this reset the next audit's hunks would
 * render pre-accepted and export could apply hunks the user never accepted.
 */
export function carryHunkStatuses<S>(
  statuses: Record<string, S>,
  prevRewrites: AuditRewrites | null,
  nextRewrites: AuditRewrites | null,
): Record<string, S> {
  return prevRewrites === nextRewrites ? statuses : {};
}

// --- Findings drawer items --------------------------------------------------

export type FindingSeverity = "blocker" | "gap" | "weak";

export interface FindingItem {
  id: string;
  severity: FindingSeverity;
  title: string;
  detail: string;
  signalId?: SignalId;
}

/** Signals at or below this score become "weak signal" findings. */
const WEAK_SIGNAL_CEIL = 55;

/**
 * Merge the LLM-derived findings (blockers, question gaps) with computed weak
 * signals into one severity-ranked list for the findings drawer.
 */
export function buildFindingItems(
  breakdown: ScoreBreakdown | null,
  findings: AuditFindings | null,
): FindingItem[] {
  const items: FindingItem[] = [];

  for (const [i, blocker] of (findings?.blockers ?? []).entries()) {
    items.push({
      id: `blocker-${i}`,
      severity: "blocker",
      title: blocker.issue,
      detail: blocker.location,
    });
  }

  for (const [i, gap] of (findings?.questionGaps ?? []).entries()) {
    items.push({
      id: `gap-${i}`,
      severity: "gap",
      title: gap,
      detail: "A question a thorough article on this topic should answer.",
    });
  }

  if (breakdown) {
    const weak = (Object.keys(breakdown.signals) as SignalId[])
      .map((id) => ({ id, score: breakdown.signals[id].score }))
      .filter((s) => s.score <= WEAK_SIGNAL_CEIL)
      .sort((a, b) => a.score - b.score);

    for (const s of weak) {
      const meta = SIGNAL_META[s.id];
      items.push({
        id: `weak-${s.id}`,
        severity: "weak",
        title: `${meta.label} scored ${s.score}`,
        detail: meta.blurb,
        signalId: s.id,
      });
    }
  }

  return items;
}

// --- Optimization roadmap ---------------------------------------------------

export type RoadmapBucket = "quick" | "strategic" | "long";

export interface RoadmapItem {
  signalId: SignalId;
  label: string;
  score: number;
  /** Σ over lenses of weight × (100 − score) — the true scoring impact of fixing this. */
  impact: number;
  lenses: Lens[];
  bucket: RoadmapBucket;
  cls: "DET" | "RUB";
}

/** RUB signals that require genuine new content work rather than a rewrite. */
const LONG_TERM_SIGNALS = new Set<SignalId>(["S15", "S17"]);

function bucketFor(signalId: SignalId, cls: "DET" | "RUB"): RoadmapBucket {
  if (cls === "DET") return "quick";
  if (LONG_TERM_SIGNALS.has(signalId)) return "long";
  return "strategic";
}

/**
 * Priority-ordered fix list. Priority is arithmetic, not vibes: each signal's
 * impact is the weight it carries across all four lenses times its shortfall
 * from 100. Signals already at 100 (or carrying no weight) are omitted.
 */
export function computeRoadmap(breakdown: ScoreBreakdown): RoadmapItem[] {
  const items: RoadmapItem[] = [];

  for (const id of Object.keys(breakdown.signals) as SignalId[]) {
    const score = breakdown.signals[id].score;
    const shortfall = 100 - score;
    if (shortfall <= 0) continue;

    let impact = 0;
    const affected: Lens[] = [];
    for (const lens of LENSES) {
      const weight = LENS_WEIGHTS[lens][id] ?? 0;
      if (weight > 0) {
        impact += weight * shortfall;
        affected.push(lens);
      }
    }
    if (impact <= 0) continue;

    const meta = SIGNAL_META[id];
    items.push({
      signalId: id,
      label: meta.label,
      score,
      impact,
      lenses: affected,
      bucket: bucketFor(id, meta.cls),
      cls: meta.cls,
    });
  }

  return items.sort((a, b) => b.impact - a.impact);
}
