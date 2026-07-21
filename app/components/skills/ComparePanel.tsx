"use client";

import { useEffect, useRef, useState } from "react";
import { cloudFetch } from "@/lib/cloud/request";
import type { CompareSkillResult, SkillTask } from "@/lib/skills/types";
import { Card } from "@/app/components/ui/Card";
import { Button } from "@/app/components/ui/Button";
import { SKILL_REGISTRY, skillProviderAside } from "./registry";
import { ERROR_COPY } from "./SkillPanelView";

type Props = {
  /** Required to actually run (ownership + ledger anchor) — Run stays disabled without it. */
  auditId?: string;
  labelAs?: "span" | "h2" | "h3";
};

/**
 * app/api/skills/compare/route.ts (DATA-CONTRACT §8, W8 subset) is the only
 * skill route that streams progress instead of completing in one
 * request/response — SkillPanel's POST-then-GET-poll shape doesn't fit, so
 * this panel owns its own SSE fetch instead of reusing SkillPanel.
 */
type CompareStreamEvent =
  | { type: "compare:progress"; completed: number; total: number }
  | { type: "compare:done"; task: SkillTask<CompareSkillResult> };

/** Route-local frame parser — one per stream shape (lib/skills/agentStream.ts's
 * parseAgentFrame, lib/audit/stream.ts's parseSiteAuditFrame are this
 * codebase's existing siblings), since compare:* frames aren't part of the
 * shared §9 AgentStreamEvent union. Exported for the unit tests below. */
export function parseCompareFrame(frame: string): CompareStreamEvent | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(dataLines.join("\n"));
    if (parsed && typeof parsed === "object" && "type" in parsed) return parsed as CompareStreamEvent;
    return null;
  } catch {
    return null;
  }
}

export function ComparePanel({ auditId, labelAs }: Props) {
  const entry = SKILL_REGISTRY.compare;

  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [task, setTask] = useState<SkillTask<CompareSkillResult> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight stream reader on unmount — no leaked readers.
  useEffect(() => () => abortRef.current?.abort(), []);

  if (!entry || !entry.enabled) return null;

  const start = async () => {
    if (busy || !auditId || !keyword.trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setTask(null);
    setProgress(null);

    let receivedDone = false;
    try {
      const response = await cloudFetch("/api/skills/compare", {
        method: "POST",
        body: JSON.stringify({ auditId, keyword: keyword.trim(), topN: 3 }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error === "rate_limit" ? ERROR_COPY.rate_limit : "This check could not be started.");
        return;
      }

      const reader = response.body.getReader();
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
          const event = parseCompareFrame(frame);
          if (event?.type === "compare:progress") setProgress({ completed: event.completed, total: event.total });
          if (event?.type === "compare:done") {
            setTask(event.task);
            receivedDone = true;
          }
          boundary = buffer.indexOf("\n\n");
        }
      }

      if (!receivedDone) setError("Connection dropped before this comparison finished.");
    } catch {
      if (!controller.signal.aborted) setError("This check could not be started.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  const runningLabel = progress ? `Auditing competitors… ${progress.completed}/${progress.total}` : entry.runningLabel;

  return (
    <Card label={entry.label} labelAs={labelAs ?? "h3"} aside={skillProviderAside(entry)}>
      <div className="p-3.5">
        <div className="flex min-w-0 flex-col gap-4">
          {!task && !busy && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="max-w-2xl">
                <p className="text-sm font-medium text-text-1">{entry.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-text-3">{entry.description}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-text-3">{entry.costNote}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="Keyword…"
                  maxLength={200}
                  aria-label={`Keyword for ${entry.label}`}
                  className="h-8 w-44 min-w-0 border border-line bg-surface-1 px-2.5 font-mono text-xs text-text-1 placeholder:text-text-3 focus:border-line-strong focus:outline-none"
                />
                <Button size="sm" onClick={() => void start()} disabled={busy || !auditId || !keyword.trim()}>
                  {busy ? "Starting…" : entry.startLabel}
                </Button>
              </div>
            </div>
          )}

          {busy && (
            <div role="status" className="rounded-[var(--radius-lg,5px)] border border-line-strong bg-surface-2 p-3">
              <p className="font-mono text-xs uppercase tracking-wider text-accent-ink">{runningLabel}</p>
            </div>
          )}

          {task?.status === "complete" && (
            <>
              <entry.Result task={task} />
              {task.costUsd > 0 && (
                <p className="font-mono text-[10px] uppercase tracking-wide text-text-3">Cost: ${task.costUsd.toFixed(4)}</p>
              )}
            </>
          )}

          {task?.status === "failed" && task.error && (
            <p role="alert" className="text-xs text-score-weak">
              {ERROR_COPY[task.error.kind]}
            </p>
          )}

          {error && (
            <p role="alert" className="text-xs text-score-weak">
              {error}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
