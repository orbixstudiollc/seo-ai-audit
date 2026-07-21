"use client";

import { notFound } from "next/navigation";
import { Card } from "@/app/components/ui/Card";
import { SkillPanelView } from "@/app/components/skills/SkillPanelView";
import { SKILL_REGISTRY, skillProviderAside } from "@/app/components/skills/registry";
import { ALL_SKILL_MOCKS } from "@/lib/skills/mocks";
import type { SkillTask } from "@/lib/skills/types";
import { AgentReportView } from "@/app/components/audit/AgentReportView";
import { agentStreamReducer, INITIAL_AGENT_STREAM_STATE, type AgentStreamState } from "@/app/hooks/useAgentStream";
import { mockAgentRunEvents, mockAgentPlanOnlyEvents, mockAgentErrorEvents } from "@/lib/audit/mockAgentRun";

const MOCK_URL = "https://example.test";
const noop = () => {};

/** Replay one of lib/audit/mockAgentRun.ts's canonical event streams through
 * the real reducer, so these sections render exactly what the live hook
 * would have produced for the same frames. */
function replay(events: typeof mockAgentRunEvents, planOnly: boolean): AgentStreamState {
  const start = agentStreamReducer(INITIAL_AGENT_STREAM_STATE, { type: "reset", planOnly });
  return events.reduce((state, event) => agentStreamReducer(state, event), start);
}

/** The full-run replay ends with one pending handoff, which AgentReportView
 * renders as a live, network-fetching SkillPanel — wrong for this page's
 * "no network calls" contract. Resolve it up front so this section only
 * ever shows the completed row, the same way reopening a saved report would
 * once SK3's persistence lands. */
const RESOLVED_TECHNICAL_CRAWL: SkillTask = {
  id: "mock-task-tech-1",
  skillId: "technical-crawl",
  scope: { kind: "site", url: MOCK_URL },
  status: "complete",
  createdAt: "2026-07-20T09:06:00.000Z",
  updatedAt: "2026-07-20T09:06:30.000Z",
  costUsd: 0.05,
  resultVersion: 1,
  result: { pagesCrawled: 26, onpageScore: 82 },
};

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

      <h2 className="mt-12 text-2xl font-semibold text-text-1">Agent mode</h2>
      <p className="mt-1 text-sm text-text-3">
        AgentReportView replayed against lib/audit/mockAgentRun.ts&apos;s canonical DATA-CONTRACT §9 event streams,
        through the real reducer — no /api/audit/agent dependency (that route doesn&apos;t exist yet).
      </p>

      <div className="mt-8 flex flex-col gap-8">
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-3">Plan only (confirm gate)</p>
          <AgentReportView
            url={MOCK_URL}
            {...replay(mockAgentPlanOnlyEvents, true)}
            confirm={noop}
            retry={noop}
            resolvePending={noop}
          />
        </div>

        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-3">
            Confirmed run (done, handoff resolved)
          </p>
          <AgentReportView
            url={MOCK_URL}
            {...agentStreamReducer(replay(mockAgentRunEvents, false), {
              type: "pending-resolved",
              taskId: "mock-task-tech-1",
              task: RESOLVED_TECHNICAL_CRAWL,
            })}
            confirm={noop}
            retry={noop}
            resolvePending={noop}
          />
        </div>

        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-3">Rejected — over budget</p>
          <AgentReportView
            url={MOCK_URL}
            {...replay(mockAgentErrorEvents, false)}
            confirm={noop}
            retry={noop}
            resolvePending={noop}
          />
        </div>
      </div>
    </main>
  );
}
