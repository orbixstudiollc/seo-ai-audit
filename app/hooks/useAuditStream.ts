"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import type { DetSignalId, DetSignalResult, ScoreBreakdown } from "@aeo/scoring";
import type {
  AuditErrorKind,
  AuditFindings,
  AuditRewrites,
  AuditStreamEvent,
  AuditStreamPhase,
  PageMeta,
} from "@/lib/audit/types";
import { parseAuditFrame } from "@/lib/audit/stream";

/**
 * Accumulated state one streamed audit run holds — the client-side
 * DATA-CONTRACT §4 report, plus `phase`/`error` for progressive rendering.
 */
export interface AuditStreamState {
  phase: AuditStreamPhase;
  page: PageMeta | null;
  signals: Record<DetSignalId, DetSignalResult> | null;
  scores: ScoreBreakdown | null;
  findings: AuditFindings | null;
  rewrites: AuditRewrites | null;
  error: { kind: AuditErrorKind; message: string; retryAfter?: number } | null;
}

export const INITIAL_AUDIT_STREAM_STATE: AuditStreamState = {
  phase: "idle",
  page: null,
  signals: null,
  scores: null,
  findings: null,
  rewrites: null,
  error: null,
};

/** Lifecycle transitions the hook drives itself, outside the wire event union. */
type LifecycleAction = { type: "reset" } | { type: "streaming" };

type AuditStreamAction = AuditStreamEvent | LifecycleAction;

/**
 * Pure accumulation logic: one wire event (or hook-internal lifecycle action)
 * folded into state. Exported so tests can drive it directly with synthetic
 * frame sequences, independent of fetch/ReadableStream plumbing.
 */
export function auditStreamReducer(state: AuditStreamState, action: AuditStreamAction): AuditStreamState {
  switch (action.type) {
    case "reset":
      return { ...INITIAL_AUDIT_STREAM_STATE, phase: "connecting" };
    case "streaming":
      return { ...state, phase: "streaming" };
    case "meta":
      return { ...state, page: action.page };
    case "signals":
      return { ...state, signals: action.signals };
    case "scores":
      return { ...state, scores: action.scores, findings: action.findings };
    case "rewrites":
      return { ...state, rewrites: action.rewrites };
    case "done":
      return { ...state, phase: "done" };
    case "error":
      return {
        ...state,
        phase: "error",
        error: { kind: action.kind, message: action.message, retryAfter: action.retryAfter },
      };
    default:
      return state;
  }
}

interface HttpErrorBody {
  error?: string;
  message?: string;
  retryAfter?: number;
}

function errorFromHttpStatus(status: number, body: HttpErrorBody | null): AuditStreamEvent & { type: "error" } {
  return {
    type: "error",
    kind: (body?.error as AuditErrorKind | undefined) ?? "server",
    message: body?.message ?? `Audit request failed (${status}).`,
    retryAfter: body?.retryAfter,
  };
}

export interface UseAuditStreamResult extends AuditStreamState {
  /** Re-run the same POST — the only recovery affordance in v1 (no resume/polling). */
  retry: () => void;
}

/**
 * Streams one audit run for `url`: POSTs /api/audit, reads the SSE body via
 * fetch + a stream reader, and accumulates meta -> signals -> scores ->
 * rewrites -> done into state via `auditStreamReducer`. No resume/recovery —
 * a dropped connection or non-2xx response is just an error state with
 * partial data left in place; `retry()` re-POSTs the same url.
 */
export function useAuditStream(url: string): UseAuditStreamResult {
  const [state, dispatch] = useReducer(auditStreamReducer, INITIAL_AUDIT_STREAM_STATE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: "reset" });

    void (async () => {
      try {
        const res = await fetch("/api/audit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as HttpErrorBody | null;
          dispatch(errorFromHttpStatus(res.status, body));
          return;
        }

        dispatch({ type: "streaming" });

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
            const event = parseAuditFrame(frame);
            if (event) {
              dispatch(event);
              if (event.type === "done" || event.type === "error") ended = true;
            }
            boundary = buffer.indexOf("\n\n");
          }
        }

        if (!ended) {
          dispatch({ type: "error", kind: "server", message: "Connection dropped before the audit finished." });
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        dispatch({
          type: "error",
          kind: "server",
          message: err instanceof Error ? err.message : "Audit stream interrupted.",
        });
      }
    })();

    return () => controller.abort();
  }, [url, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, retry };
}
