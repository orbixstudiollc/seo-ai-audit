import { describe, expect, it } from "vitest";
import type { AgentStreamEvent, SkillTask } from "@/lib/skills/types";
import { mockAgentRunEvents, mockAgentPlanOnlyEvents, mockAgentErrorEvents } from "@/lib/audit/mockAgentRun";
import { agentStreamReducer, INITIAL_AGENT_STREAM_STATE, type AgentStreamState } from "@/app/hooks/useAgentStream";

/**
 * `agentStreamReducer` is the hook's pure accumulation logic (no fetch, no
 * React) — folds the canonical DATA-CONTRACT §9 mock event streams
 * (lib/audit/mockAgentRun.ts) into state, the same fixtures AgentReportView's
 * /dev/mock-skills replay sections use.
 */

function fold(events: AgentStreamEvent[], planOnly: boolean): AgentStreamState {
  const start = agentStreamReducer(INITIAL_AGENT_STREAM_STATE, { type: "reset", planOnly });
  return events.reduce((state, event) => agentStreamReducer(state, event), start);
}

describe("agentStreamReducer", () => {
  it("planOnly replay lands on confirm with the estimated total summable from rows", () => {
    const state = fold(mockAgentPlanOnlyEvents, true);
    expect(state.phase).toBe("confirm");
    expect(state.skills).toHaveLength(7);
    expect(state.skills.every((row) => row.status === "planned")).toBe(true);
    const total = state.skills.reduce((sum, row) => sum + row.estCostUsd, 0);
    expect(total).toBeCloseTo(0.08, 5);
  });

  it("a confirmed full run reaches done with the rollup present and pending handoffs", () => {
    const state = fold(mockAgentRunEvents, false);
    expect(state.phase).toBe("done");
    expect(state.actionPlan).not.toBeNull();
    expect(state.pendingTaskIds).toEqual(["mock-task-tech-1"]);
    const handoffRow = state.skills.find((row) => row.skillId === "technical-crawl");
    expect(handoffRow?.status).toBe("handoff");
    expect(handoffRow?.taskId).toBe("mock-task-tech-1");
    // Inline skills all completed with their task attached.
    const schemaRow = state.skills.find((row) => row.skillId === "schema");
    expect(schemaRow?.status).toBe("complete");
    expect(schemaRow?.task).not.toBeNull();
  });

  it("a skill-done carrying a failed task marks the row failed, not complete", () => {
    // Regression: the server emits failed skill-done events for wall-clock
    // skips and inline failures; hardcoding "complete" made the view's
    // error branch unreachable and stranded skipped rows as "Queued".
    let state = fold(mockAgentPlanOnlyEvents.filter((e) => e.type === "agent:plan"), false);
    const failedTask: SkillTask = {
      id: "mock-schema-skipped", skillId: "schema",
      scope: { kind: "page", url: "https://example.test/" },
      status: "failed", createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z",
      costUsd: 0, resultVersion: 1, result: null,
      error: { kind: "server", message: "Skipped — the run's wall-clock budget was exhausted before this skill could start." },
    };
    state = agentStreamReducer(state, { type: "agent:skill-done", skillId: "schema", task: failedTask });
    const row = state.skills.find((r) => r.skillId === "schema");
    expect(row?.status).toBe("failed");
    expect(row?.task?.error?.message).toContain("Skipped");
  });

  it("resolving every pending task empties pendingTaskIds", () => {
    let state = fold(mockAgentRunEvents, false);
    expect(state.pendingTaskIds).toHaveLength(1);
    const task: SkillTask = {
      id: "mock-task-tech-1",
      skillId: "technical-crawl",
      scope: { kind: "site", url: "https://example.test" },
      status: "complete",
      createdAt: "2026-07-20T09:06:00.000Z",
      updatedAt: "2026-07-20T09:06:30.000Z",
      costUsd: 0.05,
      resultVersion: 1,
      result: {},
    };
    state = agentStreamReducer(state, { type: "pending-resolved", taskId: "mock-task-tech-1", task });
    expect(state.pendingTaskIds).toEqual([]);
    expect(state.skills.find((row) => row.skillId === "technical-crawl")?.status).toBe("complete");
  });

  it("marks a resolved-as-failed task's row failed and still clears it from pending", () => {
    let state = fold(mockAgentRunEvents, false);
    const task: SkillTask = {
      id: "mock-task-tech-1",
      skillId: "technical-crawl",
      scope: { kind: "site", url: "https://example.test" },
      status: "failed",
      createdAt: "2026-07-20T09:06:00.000Z",
      updatedAt: "2026-07-20T09:06:30.000Z",
      costUsd: 0,
      resultVersion: 1,
      result: null,
      error: { kind: "provider_unavailable", message: "The crawl provider timed out." },
    };
    state = agentStreamReducer(state, { type: "pending-resolved", taskId: "mock-task-tech-1", task });
    expect(state.pendingTaskIds).toEqual([]);
    expect(state.skills.find((row) => row.skillId === "technical-crawl")?.status).toBe("failed");
  });

  it("an error after a rollup preserves the actionPlan and every row already accumulated", () => {
    const withRollup = fold(mockAgentRunEvents.slice(0, -1), false); // everything up to (not including) agent:done
    expect(withRollup.actionPlan).not.toBeNull();
    const state = agentStreamReducer(withRollup, { type: "agent:error", kind: "server", message: "The run timed out." });
    expect(state.phase).toBe("error");
    expect(state.error).toEqual({ kind: "server", message: "The run timed out." });
    expect(state.actionPlan).toBe(withRollup.actionPlan);
    expect(state.skills).toEqual(withRollup.skills);
  });

  it("a run rejected before fan-out lands budget_exceeded in state.error", () => {
    const errorEvent = mockAgentErrorEvents[1];
    if (errorEvent.type !== "agent:error") throw new Error("fixture changed shape");
    const state = fold(mockAgentErrorEvents, false);
    expect(state.phase).toBe("error");
    expect(state.error).toEqual({ kind: "budget_exceeded", message: errorEvent.message });
  });

  it("run_cap_exceeded also lands in state.error", () => {
    const state = agentStreamReducer(
      fold(mockAgentPlanOnlyEvents, false),
      { type: "agent:error", kind: "run_cap_exceeded", message: "This run would exceed the per-run check cap." },
    );
    expect(state.phase).toBe("error");
    expect(state.error).toEqual({ kind: "run_cap_exceeded", message: "This run would exceed the per-run check cap." });
  });

  it("reset clears prior state back to planning, remembering the new planOnly flag", () => {
    const afterError = fold(mockAgentErrorEvents, false);
    const reset = agentStreamReducer(afterError, { type: "reset", planOnly: true });
    expect(reset).toEqual({ ...INITIAL_AGENT_STREAM_STATE, phase: "planning", planOnly: true });
  });
});
