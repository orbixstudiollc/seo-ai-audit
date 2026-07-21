"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import type { ActionPlan } from "@/lib/skills/actionPlan";
import type { AgentStreamEvent, SkillErrorKind, SkillId, SkillTask } from "@/lib/skills/types";
import { parseAgentFrame } from "@/lib/skills/agentStream";

/**
 * Agent-mode sibling of useSiteAuditStream: streams POST /api/audit/agent
 * (DATA-CONTRACT §9) and accumulates one row per planned skill, keyed by
 * skillId. Built entirely against lib/audit/mockAgentRun.ts — the real
 * orchestrator route doesn't exist yet (SK3).
 */

export type AgentPhase = "idle" | "planning" | "confirm" | "running" | "done" | "error";

export interface AgentSkillRow {
  skillId: SkillId;
  mode: "inline" | "handoff";
  estCostUsd: number;
  status: "planned" | "running" | "complete" | "handoff" | "failed";
  task: SkillTask | null;
  taskId: string | null;
}

export interface AgentStreamState {
  phase: AgentPhase;
  runId: string | null;
  businessType: string | null;
  skills: AgentSkillRow[];
  actionPlan: ActionPlan | null;
  pendingTaskIds: string[];
  error: { kind: SkillErrorKind | "run_cap_exceeded"; message: string } | null;
  /** Internal: which request mode seeded the current plan — decides whether
   * the next agent:plan lands on "confirm" (dry run) or "running" (fan-out
   * already started). Not part of the wire event union, same rationale as
   * useSiteAuditStream's retryingFailed/retryPageUrls. */
  planOnly: boolean;
}

export const INITIAL_AGENT_STREAM_STATE: AgentStreamState = {
  phase: "idle",
  runId: null,
  businessType: null,
  skills: [],
  actionPlan: null,
  pendingTaskIds: [],
  error: null,
  planOnly: true,
};

type LifecycleAction = { type: "reset"; planOnly: boolean };
type PendingResolvedAction = { type: "pending-resolved"; taskId: string; task: SkillTask };
type AgentAction = AgentStreamEvent | LifecycleAction | PendingResolvedAction;

function seedRows(skills: Array<{ skillId: SkillId; mode: "inline" | "handoff"; estCostUsd: number }>): AgentSkillRow[] {
  return skills.map((skill) => ({ ...skill, status: "planned", task: null, taskId: null }));
}

function updateRow(rows: AgentSkillRow[], skillId: SkillId, patch: Partial<AgentSkillRow>): AgentSkillRow[] {
  return rows.map((row) => (row.skillId === skillId ? { ...row, ...patch } : row));
}

/**
 * Pure accumulation logic — exported so tests can drive it directly with
 * synthetic event sequences, independent of fetch/ReadableStream plumbing.
 */
export function agentStreamReducer(state: AgentStreamState, action: AgentAction): AgentStreamState {
  switch (action.type) {
    case "reset":
      return { ...INITIAL_AGENT_STREAM_STATE, phase: "planning", planOnly: action.planOnly };
    case "agent:plan":
      return {
        ...state,
        runId: action.runId,
        businessType: action.businessType,
        skills: seedRows(action.skills),
        phase: state.planOnly ? "confirm" : "running",
      };
    case "agent:skill-start":
      return { ...state, skills: updateRow(state.skills, action.skillId, { status: "running" }) };
    case "agent:skill-done":
      return { ...state, skills: updateRow(state.skills, action.skillId, { status: "complete", task: action.task }) };
    case "agent:skill-handoff":
      return { ...state, skills: updateRow(state.skills, action.skillId, { status: "handoff", taskId: action.taskId }) };
    case "agent:rollup":
      return { ...state, actionPlan: action.actionPlan, pendingTaskIds: action.pendingTaskIds };
    case "agent:done":
      // A planOnly dry run's "done" just means the stream is finished — the
      // confirm gate stays up, it never had anywhere else to go.
      return state.phase === "confirm" ? state : { ...state, phase: "done" };
    case "agent:error":
      // Preserve everything already accumulated (rows, actionPlan) — an
      // error never discards what's already rendered.
      return { ...state, phase: "error", error: { kind: action.kind, message: action.message } };
    case "pending-resolved": {
      const failed = action.task.status === "failed";
      return {
        ...state,
        pendingTaskIds: state.pendingTaskIds.filter((id) => id !== action.taskId),
        skills: state.skills.map((row) =>
          row.taskId === action.taskId ? { ...row, status: failed ? "failed" : "complete", task: action.task } : row,
        ),
      };
    }
    default:
      return state;
  }
}

interface HttpErrorBody {
  error?: string;
  message?: string;
}

function errorFromHttpStatus(status: number, body: HttpErrorBody | null): Extract<AgentStreamEvent, { type: "agent:error" }> {
  return {
    type: "agent:error",
    kind: (body?.error as SkillErrorKind | "run_cap_exceeded" | undefined) ?? "server",
    message: body?.message ?? `Agent audit request failed (${status}).`,
  };
}

export interface AgentStreamRequest {
  url: string;
  planOnly?: boolean;
}

export async function consumeAgentStream(
  request: AgentStreamRequest,
  signal: AbortSignal,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<void> {
  const res = await fetch("/api/audit/agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as HttpErrorBody | null;
    onEvent(errorFromHttpStatus(res.status, body));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseAgentFrame(frame);
      if (event) {
        onEvent(event);
        if (event.type === "agent:done" || event.type === "agent:error") ended = true;
      }
      boundary = buffer.indexOf("\n\n");
    }
  }

  if (!ended) onEvent({ type: "agent:error", kind: "server", message: "Connection dropped before the agent run finished." });
}

export interface UseAgentStreamResult extends AgentStreamState {
  /** Re-run the whole dry run from scratch (the recovery affordance after an error). */
  retry: () => void;
  /** Re-POST without planOnly — starts the real (billed) fan-out. */
  confirm: () => void;
  /** Fold a polled SkillTask (from a handoff SkillPanel) back into its row. */
  resolvePending: (taskId: string, task: SkillTask) => void;
}

export function useAgentStream(url: string): UseAgentStreamResult {
  const [state, dispatch] = useReducer(agentStreamReducer, INITIAL_AGENT_STREAM_STATE);
  const [request, setRequest] = useState<{ planOnly: boolean; attempt: number }>({ planOnly: true, attempt: 0 });

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: "reset", planOnly: request.planOnly });

    void (async () => {
      try {
        await consumeAgentStream({ url, ...(request.planOnly ? { planOnly: true } : {}) }, controller.signal, dispatch);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        dispatch({
          type: "agent:error",
          kind: "server",
          message: err instanceof Error ? err.message : "Agent stream interrupted.",
        });
      }
    })();

    return () => controller.abort();
  }, [url, request]);

  const retry = useCallback(() => setRequest((current) => ({ planOnly: true, attempt: current.attempt + 1 })), []);
  const confirm = useCallback(() => setRequest((current) => ({ planOnly: false, attempt: current.attempt + 1 })), []);
  const resolvePending = useCallback(
    (taskId: string, task: SkillTask) => dispatch({ type: "pending-resolved", taskId, task }),
    [],
  );

  return { ...state, retry, confirm, resolvePending };
}
