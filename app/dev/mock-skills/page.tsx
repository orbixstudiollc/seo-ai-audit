"use client";

import { notFound } from "next/navigation";
import { Card } from "@/app/components/ui/Card";
import { SkillPanelView } from "@/app/components/skills/SkillPanelView";
import { SKILL_REGISTRY, skillProviderAside } from "@/app/components/skills/registry";
import { ALL_SKILL_MOCKS } from "@/lib/skills/mocks";
import type { SkillTask } from "@/lib/skills/types";

// AgentReportView replays (the agent-mode run event playback, driven by
// lib/audit/mockAgentRun.ts) land in SK2 — this page only exercises the
// per-skill panel states in isolation.

function stateLabel(state: string): string {
  return state.charAt(0).toUpperCase() + state.slice(1).replace(/([A-Z])/g, " $1");
}

/**
 * Development-only render target for W3-SHELL: every skill panel rendered
 * against its lifecycle mocks, no /api/skills dependency (DATA-CONTRACT §8
 * mock mandate).
 */
export default function MockSkillsPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <main className="mx-auto w-full min-w-0 max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-text-1">Mock skills</h1>
      <p className="mt-1 text-sm text-text-3">
        Every skill panel rendered against its lifecycle mocks — no network calls, no /api/skills dependency.
      </p>

      <div className="mt-8 flex flex-col gap-8">
        {ALL_SKILL_MOCKS.map(({ skillId, states }) => {
          const entry = SKILL_REGISTRY[skillId];
          if (!entry) return null;

          return (
            <Card key={skillId} label={entry.label} labelAs="h2" aside={skillProviderAside(entry)}>
              <div className="flex flex-col divide-y divide-line p-3.5">
                <div className="pb-4">
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-3">Idle</p>
                  <SkillPanelView entry={entry} task={null} ready busy={false} configured error={null} onStart={() => {}} />
                </div>

                {Object.entries(states).map(([state, task]) => (
                  <div key={state} className="py-4">
                    <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-3">{stateLabel(state)}</p>
                    <SkillPanelView entry={entry} task={task} ready busy={false} configured error={null} />
                  </div>
                ))}

                <div className="pt-4">
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-3">Budget exceeded</p>
                  <SkillPanelView
                    entry={entry}
                    task={
                      {
                        ...states.failed,
                        id: `mock-${skillId}-budget-exceeded`,
                        error: { kind: "budget_exceeded", message: "Budget limit reached." },
                      } satisfies SkillTask
                    }
                    ready
                    busy={false}
                    configured
                    error={null}
                  />
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
