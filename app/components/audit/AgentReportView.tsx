"use client";

import Link from "next/link";
import type { AgentSkillRow, AgentStreamState } from "@/app/hooks/useAgentStream";
import type { SkillErrorKind, SkillTask } from "@/lib/skills/types";
import { SKILL_REGISTRY } from "@/app/components/skills/registry";
import { SkillPanel } from "@/app/components/skills/SkillPanel";
import { Card } from "@/app/components/ui/Card";
import { Button } from "@/app/components/ui/Button";
import { ActionPlanPanel } from "./ActionPlanPanel";

type Props = AgentStreamState & {
  /** The audited URL — not part of the stream state, needed to scope the
   * handoff skill's SkillPanel (site-wide checks per DATA-CONTRACT §8). */
  url: string;
  confirm: () => void;
  retry: () => void;
  resolvePending: (taskId: string, task: SkillTask) => void;
};

const ROW_STATUS: Record<AgentSkillRow["status"], { glyph: string; label: string }> = {
  planned: { glyph: "·", label: "Queued" },
  running: { glyph: "•", label: "Running" },
  complete: { glyph: "✓", label: "Done" },
  handoff: { glyph: "•", label: "Continues in background" },
  failed: { glyph: "✕", label: "Failed" },
};

function rowColor(status: AgentSkillRow["status"]): string {
  if (status === "failed") return "var(--score-weak)";
  if (status === "complete") return "var(--score-strong)";
  if (status === "running" || status === "handoff") return "var(--accent-ink)";
  return "var(--text-3)";
}

const ERROR_COPY: Record<SkillErrorKind | "run_cap_exceeded", string> = {
  invalid_input: "This run couldn't start — the input looked invalid.",
  fetch_failed: "Couldn't fetch the page to plan this run.",
  unsupported_content: "This page's content isn't supported by agent mode.",
  provider_unavailable: "Agent mode isn't configured on the server yet.",
  budget_exceeded: "This run would exceed your monthly skill budget — no checks were run.",
  rate_limit: "Rate limit hit — try again shortly.",
  server: "Something went wrong running this agent audit.",
  run_cap_exceeded: "This run would exceed the per-run check cap — no checks were run.",
};

function skillLabel(skillId: AgentSkillRow["skillId"]): string {
  return SKILL_REGISTRY[skillId]?.label ?? skillId;
}

function sum(skills: AgentSkillRow[], pick: (row: AgentSkillRow) => number): number {
  return skills.reduce((total, row) => total + pick(row), 0);
}

/** A handoff row's embedded SkillPanel — narrows `row.taskId` to `string` once. */
function HandoffPanel({
  row,
  url,
  resolvePending,
}: {
  row: AgentSkillRow & { taskId: string };
  url: string;
  resolvePending: (taskId: string, task: SkillTask) => void;
}) {
  return (
    <div className="mt-1">
      <SkillPanel
        skillId={row.skillId}
        scope={{ kind: "site", url }}
        initialTaskId={row.taskId}
        labelAs="h3"
        onComplete={(task) => resolvePending(row.taskId, task)}
      />
    </div>
  );
}

/**
 * The agent-mode report: confirm-gate plan card -> progress rows as skills
 * fan out -> ActionPlanPanel once the rollup lands. Presentational only —
 * AgentAuditRunner owns the stream and passes state + callbacks straight
 * through (DATA-CONTRACT §9 UX walkthrough).
 */
export function AgentReportView({ phase, businessType, skills, actionPlan, error, url, confirm, resolvePending }: Props) {
  if (phase === "idle" || phase === "planning") {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
        <p role="status" className="wb-skeleton font-mono text-xs text-text-3">
          Planning your checks…
        </p>
      </div>
    );
  }

  const isConfirm = phase === "confirm";
  const estimatedTotal = sum(skills, (row) => row.estCostUsd);
  const actualSoFar = sum(skills, (row) => (row.status === "complete" && row.task ? row.task.costUsd : 0));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg,5px)] border px-3.5 py-3"
          style={{ borderColor: "var(--score-weak)", backgroundColor: "var(--score-weak-tint)" }}
        >
          <p className="text-[13px] leading-snug" style={{ color: "var(--score-weak)" }}>
            {ERROR_COPY[error.kind]}
          </p>
        </div>
      )}

      {skills.length > 0 && (
        <Card
          label="Agent plan"
          labelAs="h2"
          aside={
            businessType ? (
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-3">{businessType}</span>
            ) : undefined
          }
        >
          <ul className="divide-y divide-line">
            {skills.map((row) => {
              const entry = SKILL_REGISTRY[row.skillId];
              return (
                <li key={row.skillId} className="flex flex-col gap-1.5 px-3.5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-1">
                      {skillLabel(row.skillId)}
                    </span>
                    {isConfirm ? (
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="font-mono text-[10px] uppercase tracking-wide text-text-3">
                          {row.mode === "inline" ? "inline" : "continues in background"}
                        </span>
                        <span className="font-mono text-xs font-semibold tabular-nums text-text-1">
                          ${row.estCostUsd.toFixed(2)}
                        </span>
                      </span>
                    ) : (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-wide"
                        style={{ color: rowColor(row.status) }}
                      >
                        <span aria-hidden="true" className={row.status === "running" ? "wb-skeleton" : ""}>
                          {ROW_STATUS[row.status].glyph}
                        </span>
                        {ROW_STATUS[row.status].label}
                      </span>
                    )}
                  </div>

                  {!isConfirm && row.status === "complete" && row.task && entry && (
                    <details className="mt-1">
                      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wide text-accent-ink">
                        View result
                      </summary>
                      <div className="mt-2">
                        <entry.Result task={row.task} />
                      </div>
                    </details>
                  )}

                  {!isConfirm && row.status === "failed" && row.task?.error && (
                    <p role="alert" className="text-xs text-score-weak">
                      {row.task.error.message}
                    </p>
                  )}

                  {!isConfirm && row.status === "handoff" && row.taskId !== null && (
                    <HandoffPanel row={{ ...row, taskId: row.taskId }} url={url} resolvePending={resolvePending} />
                  )}
                </li>
              );
            })}
          </ul>

          {isConfirm && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3.5 py-3">
              <p className="font-mono text-xs uppercase tracking-wide text-text-3">
                Estimated total ${estimatedTotal.toFixed(2)}
              </p>
              <div className="flex items-center gap-3">
                <Link href="/" className="font-mono text-xs uppercase tracking-wide text-text-3 hover:text-accent-ink">
                  Cancel
                </Link>
                <Button size="sm" onClick={confirm}>
                  Run {skills.length} checks
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {actionPlan && (
        <>
          <ActionPlanPanel plan={actionPlan} />
          <p className="font-mono text-[10px] uppercase tracking-wide text-text-3">
            Actual cost so far ${actualSoFar.toFixed(2)}
          </p>
        </>
      )}
    </div>
  );
}
