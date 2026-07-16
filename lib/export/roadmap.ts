import {
  DET_SIGNAL_IDS,
  LENSES,
  LENS_WEIGHTS,
  SIGNAL_IDS,
  type ScoreBreakdown,
  type SignalId,
} from "@aeo/scoring";
import type { AuditFindings } from "../audit/types";
import { SIGNAL_META } from "../audit/signalMeta";

/**
 * The computed priority roadmap — arithmetic, not vibes (plan §Optimization
 * Roadmap): every weak signal becomes a fix item with
 * priority = Σ(lens weight × (100 − score)) across the four lenses, using
 * LENS_WEIGHTS from @aeo/scoring so the numbers can never drift from the
 * scoring engine. Rendered as a markdown checklist grouped Quick Wins
 * (mechanical DET fixes) / Strategic (RUB content work) / Long-term (polish).
 */

export interface RoadmapItem {
  signalId: SignalId;
  label: string;
  score: number;
  priority: number;
}

/** Below this a signal is an active problem (quick win / strategic work). */
const PROBLEM_SCORE_CEIL = 70;
/** Between PROBLEM_SCORE_CEIL and this, a signal is long-term polish; at or above it, it is omitted. */
const POLISH_SCORE_CEIL = 90;

const DET_SET = new Set<SignalId>(DET_SIGNAL_IDS);

/** priority = Σ over lenses of weight × (100 − score). Signals a lens does not weight contribute 0 to it. */
export function signalPriority(id: SignalId, breakdown: ScoreBreakdown): number {
  const score = breakdown.signals[id].score;
  return LENSES.reduce((sum, lens) => sum + (LENS_WEIGHTS[lens][id] ?? 0) * (100 - score), 0);
}

type RoadmapGroup = "quick" | "strategic" | "longterm";

function groupFor(id: SignalId, score: number): RoadmapGroup | null {
  if (score >= POLISH_SCORE_CEIL) return null;
  if (score >= PROBLEM_SCORE_CEIL) return "longterm";
  return DET_SET.has(id) ? "quick" : "strategic";
}

/** Descending priority; ties broken by canonical signal order for determinism. */
function byPriorityDesc(a: RoadmapItem, b: RoadmapItem): number {
  if (b.priority !== a.priority) return b.priority - a.priority;
  return SIGNAL_IDS.indexOf(a.signalId) - SIGNAL_IDS.indexOf(b.signalId);
}

function signalLine(item: RoadmapItem): string {
  const meta = SIGNAL_META[item.signalId];
  return `- [ ] **${meta.label}** (${item.signalId}) — score ${item.score}/100 · priority ${item.priority} — ${meta.blurb}`;
}

function section(title: string, lines: readonly string[]): string {
  const body = lines.length > 0 ? lines.join("\n") : "_No items._";
  return `## ${title}\n\n${body}`;
}

export function buildRoadmapMarkdown(
  scoreBreakdown: ScoreBreakdown,
  findings: AuditFindings | null,
): string {
  const groups: Record<RoadmapGroup, RoadmapItem[]> = {
    quick: [],
    strategic: [],
    longterm: [],
  };

  for (const id of SIGNAL_IDS) {
    const score = scoreBreakdown.signals[id].score;
    const group = groupFor(id, score);
    if (!group) continue;
    groups[group].push({
      signalId: id,
      label: SIGNAL_META[id].label,
      score,
      priority: signalPriority(id, scoreBreakdown),
    });
  }

  const quickLines = [
    ...(findings?.blockers ?? []).map(
      (b) => `- [ ] **Fix AI Overview blocker:** ${b.issue} — ${b.location}`,
    ),
    ...groups.quick.sort(byPriorityDesc).map(signalLine),
  ];

  const strategicLines = [
    ...groups.strategic.sort(byPriorityDesc).map(signalLine),
    ...(findings?.questionGaps ?? []).map((q) => `- [ ] **Cover the question:** ${q}`),
    ...(findings?.anchorSuggestions ?? []).map(
      (a) => `- [ ] **Add a source for:** "${a.claim}" — suggested: ${a.suggestedSourceType}`,
    ),
  ];

  const longtermLines = groups.longterm.sort(byPriorityDesc).map(signalLine);

  return [
    "# Optimization Roadmap",
    "",
    "Priority = lens weight × (100 − signal score), summed across the AEO, GEO, Citability, and AI Overview lenses. Higher priority = bigger score payoff per fix.",
    "",
    section("Quick Wins", quickLines),
    "",
    section("Strategic", strategicLines),
    "",
    section("Long-term", longtermLines),
    "",
  ].join("\n");
}
