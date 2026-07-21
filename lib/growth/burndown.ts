import type { AuditHistoryRecord } from "@/lib/history";
import type { ActionPlan } from "@/lib/skills/actionPlan";

/**
 * G3 site hub — progress trend derived entirely from data every audit
 * already stores (`AuditHistoryRecord.details`), so a domain's history gets
 * a burndown with zero new persistence or fetches. This is an approximation
 * ("issues surfaced," not a literal action-plan item count) since compact
 * history rows don't retain full findings; `diffActionPlans` below gives the
 * exact figure for the one comparison that matters most (latest vs previous
 * full audit) by diffing two actually-loaded ActionPlans.
 */

/** Count of surfaced issues for one audit, from its stored compact details. Null if no details yet (e.g. still running). */
export function openIssueCount(record: AuditHistoryRecord): number | null {
  const details = record.details;
  if (!details) return null;
  if (details.kind === "single") {
    return details.weakestSignals.length + details.blockers.length + details.questionGaps.length;
  }
  return details.commonFindings.length + details.worstPages.length + (details.pagesFailed > 0 ? 1 : 0);
}

/** Chronological (oldest → newest) issue-count series for a domain's audit history. */
export function domainIssueTrend(records: readonly AuditHistoryRecord[]): number[] {
  return [...records]
    .filter((record) => openIssueCount(record) !== null)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((record) => openIssueCount(record) as number);
}

export interface ActionPlanDiff {
  resolved: number;
  introduced: number;
}

/** Exact item-id diff between two loaded action plans. Null when either side is unavailable. */
export function diffActionPlans(previous: ActionPlan | null, current: ActionPlan | null): ActionPlanDiff | null {
  if (!previous || !current) return null;
  const previousIds = new Set(previous.items.map((item) => item.id));
  const currentIds = new Set(current.items.map((item) => item.id));
  return {
    resolved: [...previousIds].filter((id) => !currentIds.has(id)).length,
    introduced: [...currentIds].filter((id) => !previousIds.has(id)).length,
  };
}
