"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DetSignalId, DetSignalResult, ScoreBreakdown } from "@aeo/scoring";
import type { AuditErrorKind, AuditFindings, AuditRewrites, WorkbenchAudit } from "@/lib/audit/types";
import type { ApiKeyProvider } from "@/lib/keys/types";
import { parseAuditFrame } from "@/lib/audit/stream";
import { getAuditStatus } from "@/app/actions/audit";

/**
 * POST body for starting an audit. `provider` is the user's localStorage
 * audit-provider preference (see lib/keys/preference.ts); it's optional because
 * the server validates it against the user's stored keys and falls back to a
 * sensible default, so the workbench can send it best-effort. Content is NOT
 * sent — the server always audits the persisted document by id.
 */
export interface StartAuditInput {
  documentId: string;
  provider?: ApiKeyProvider;
}

export type AuditStreamPhase = "idle" | "connecting" | "streaming" | "done" | "error";

export interface AuditStreamState {
  phase: AuditStreamPhase;
  detSignals: Record<DetSignalId, DetSignalResult> | null;
  scores: ScoreBreakdown | null;
  findings: AuditFindings | null;
  rewrites: AuditRewrites | null;
  auditId: string | null;
  error: { kind: AuditErrorKind; message: string; retryAfter?: number } | null;
}

const INITIAL: AuditStreamState = {
  phase: "idle",
  detSignals: null,
  scores: null,
  findings: null,
  rewrites: null,
  auditId: null,
  error: null,
};

export interface UseAuditStream extends AuditStreamState {
  start: (input: StartAuditInput) => void;
  /**
   * Resume a previously-started audit by polling its persisted phases instead
   * of POSTing a new one — the recovery path for a client that reopens the doc
   * after its SSE stream dropped (tab close, network blip, LB idle-timeout).
   * Never re-spends: it only reads the audits row until a terminal status.
   */
  resume: (auditId: string) => void;
  cancel: () => void;
}

const POLL_INTERVAL_MS = 3000;

const ALLOWED_ERROR_KINDS: readonly AuditErrorKind[] = [
  "no_key",
  "invalid_key",
  "rate_limit",
  "quota",
  "auth",
  "already_running",
  "server",
];

function toErrorKind(value: unknown): AuditErrorKind {
  return typeof value === "string" && (ALLOWED_ERROR_KINDS as readonly string[]).includes(value)
    ? (value as AuditErrorKind)
    : "server";
}

/**
 * Best-effort narrow of a non-2xx JSON error body (`{ error: { kind, message,
 * retryAfterSec? } }`) into stream-error state, so the route's authored
 * messages (e.g. "Add your key in Settings", rate-limit waits) reach the UI
 * instead of a generic status string. Returns null on any unexpected shape.
 */
function extractJsonError(
  body: unknown,
): { kind: AuditErrorKind; message: string; retryAfter?: number } | null {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const inner = (body as { error: unknown }).error;
  if (!inner || typeof inner !== "object") return null;
  const rec = inner as { kind?: unknown; message?: unknown; retryAfterSec?: unknown; retryAfter?: unknown };
  if (typeof rec.message !== "string") return null;
  const retry =
    typeof rec.retryAfterSec === "number"
      ? rec.retryAfterSec
      : typeof rec.retryAfter === "number"
        ? rec.retryAfter
        : undefined;
  return {
    kind: toErrorKind(rec.kind),
    message: rec.message,
    ...(retry !== undefined ? { retryAfter: retry } : {}),
  };
}

/** Resolve after `ms`, or immediately if `signal` aborts first. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Fold a persisted audit row into stream state, preserving any phase already streamed in. */
function hydrateFromStatus(
  setState: React.Dispatch<React.SetStateAction<AuditStreamState>>,
  audit: WorkbenchAudit,
): void {
  setState((s) => ({
    ...s,
    auditId: audit.id,
    scores: audit.scores ?? s.scores,
    findings: audit.findings ?? s.findings,
    rewrites: audit.rewrites ?? s.rewrites,
  }));
}

/**
 * Runs an audit by POSTing to /api/audit and consuming its SSE stream, exposing
 * each phase (DET signals -> scores+findings -> rewrites -> done) as it lands.
 *
 * On unmount it aborts the client-side reader only; the plan decouples the paid
 * LLM call from the response via `after()`/`waitUntil()`, so the server finishes
 * and persists the audit regardless of whether this reader is still attached.
 *
 * ponytail: this is the sibling-owned "SSE consumer hook" seam — a real
 * fetch-stream implementation, not a stub. Reconcile the import at integrate if
 * a sibling ships a duplicate.
 */
export function useAuditStream(): UseAuditStream {
  const [state, setState] = useState<AuditStreamState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const start = useCallback(
    (input: StartAuditInput) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ ...INITIAL, phase: "connecting" });

      void (async () => {
        try {
          const res = await fetch("/api/audit", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(input),
            signal: controller.signal,
          });

          if (!res.ok || !res.body) {
            const parsed: unknown = await res.json().catch(() => null);
            const error = extractJsonError(parsed) ?? {
              kind: "server" as AuditErrorKind,
              message: `Audit request failed (${res.status}).`,
            };
            setState((s) => ({ ...s, phase: "error", error }));
            return;
          }

          setState((s) => ({ ...s, phase: "streaming" }));

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let boundary = buffer.indexOf("\n\n");
            while (boundary >= 0) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const event = parseAuditFrame(frame);
              if (event) applyEvent(setState, event);
              boundary = buffer.indexOf("\n\n");
            }
          }

          setState((s) => (s.phase === "error" ? s : { ...s, phase: "done" }));
        } catch (err: unknown) {
          if (controller.signal.aborted) return;
          setState((s) => ({
            ...s,
            phase: "error",
            error: {
              kind: "server",
              message: err instanceof Error ? err.message : "Audit stream interrupted.",
            },
          }));
        }
      })();
    },
    [],
  );

  const resume = useCallback((auditId: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ ...INITIAL, phase: "connecting", auditId });

    void (async () => {
      try {
        setState((s) => ({ ...s, phase: "streaming" }));
        for (;;) {
          if (controller.signal.aborted) return;
          const audit = await getAuditStatus(auditId);
          if (controller.signal.aborted) return;
          if (!audit) {
            setState((s) => ({
              ...s,
              phase: "error",
              error: { kind: "server", message: "Audit not found." },
            }));
            return;
          }
          hydrateFromStatus(setState, audit);
          if (audit.status === "completed") {
            setState((s) => (s.phase === "error" ? s : { ...s, phase: "done" }));
            return;
          }
          if (audit.status === "failed") {
            // The route persists the mapped user-friendly provider message
            // (quota/auth/etc.) into audits.error — surface it over a generic.
            setState((s) => ({
              ...s,
              phase: "error",
              error: { kind: "server", message: audit.error ?? "Audit failed on the server." },
            }));
            return;
          }
          await wait(POLL_INTERVAL_MS, controller.signal);
        }
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setState((s) => ({
          ...s,
          phase: "error",
          error: {
            kind: "server",
            message: err instanceof Error ? err.message : "Audit recovery failed.",
          },
        }));
      }
    })();
  }, []);

  return { ...state, start, resume, cancel };
}

function applyEvent(
  setState: React.Dispatch<React.SetStateAction<AuditStreamState>>,
  event: ReturnType<typeof parseAuditFrame>,
): void {
  if (!event) return;
  switch (event.type) {
    case "signals":
      setState((s) => ({ ...s, detSignals: event.signals }));
      break;
    case "scores":
      setState((s) => ({ ...s, scores: event.scores, findings: event.findings }));
      break;
    case "rewrites":
      setState((s) => ({ ...s, rewrites: event.rewrites }));
      break;
    case "done":
      setState((s) => ({ ...s, auditId: event.auditId, phase: "done" }));
      break;
    case "error":
      setState((s) => ({
        ...s,
        phase: "error",
        error: { kind: event.kind, message: event.message, retryAfter: event.retryAfter },
      }));
      break;
  }
}
