import type { SkillErrorKind, SkillTask } from "@/lib/skills/types";
import { Button } from "@/app/components/ui/Button";
import type { SkillRegistryEntry } from "./registry";

type Props = {
  entry: SkillRegistryEntry;
  task: SkillTask | null;
  ready: boolean;
  busy: boolean;
  configured: boolean;
  error: string | null;
  onStart?: () => void;
  /** Keyword-scoped skills only: controlled input rendered in the idle state. */
  keywordValue?: string;
  onKeywordChange?: (value: string) => void;
};

type Phase = "idle" | "loading" | "complete" | "failed";

function derivePhase(task: SkillTask | null): Phase {
  if (!task) return "idle";
  if (task.status === "complete") return "complete";
  if (task.status === "failed") return "failed";
  return "loading"; // creating | queued | running
}

const ERROR_COPY: Record<SkillErrorKind, string> = {
  invalid_input: "This check couldn't run — the input looked invalid.",
  fetch_failed: "Couldn't fetch the page to run this check.",
  unsupported_content: "This page's content isn't supported by this check.",
  provider_unavailable: "This check isn't configured on the server yet.",
  budget_exceeded: "Budget limit reached — this check was not run.",
  rate_limit: "Rate limit hit — try again shortly.",
  server: "Something went wrong running this check.",
};

/**
 * Pure renderer for one skill panel's content (no fetching, no Card — the
 * caller wraps it, per DATA-CONTRACT §8). Mirrors TechnicalSeoPanel's
 * idle/loading/complete/failed states, generalized across every skill.
 */
export function SkillPanelView({ entry, task, ready, busy, configured, error, onStart, keywordValue, onKeywordChange }: Props) {
  const phase = derivePhase(task);
  const needsKeyword = entry.scopeKind === "keyword" && onKeywordChange !== undefined;
  const startDisabled = busy || !configured || (needsKeyword && !(keywordValue ?? "").trim());

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!ready && <p className="wb-skeleton font-mono text-xs text-text-3">Checking {entry.label.toLowerCase()}…</p>}

      {ready && phase === "idle" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-text-1">{entry.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-text-3">{entry.description}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-text-3">{entry.costNote}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {needsKeyword && (
              <input
                type="text"
                value={keywordValue ?? ""}
                onChange={(event) => onKeywordChange(event.target.value)}
                placeholder="Keyword…"
                maxLength={200}
                aria-label={`Keyword for ${entry.label}`}
                className="h-8 w-44 min-w-0 border border-line bg-surface-1 px-2.5 font-mono text-xs text-text-1 placeholder:text-text-3 focus:border-line-strong focus:outline-none"
              />
            )}
            {onStart && (
              <Button size="sm" onClick={onStart} disabled={startDisabled}>
                {busy ? "Starting…" : entry.startLabel}
              </Button>
            )}
          </div>
        </div>
      )}

      {ready && phase === "idle" && !configured && (
        <p role="status" className="text-xs text-text-3">
          This check is not configured on the server yet.
        </p>
      )}

      {ready && phase === "loading" && (
        <div role="status" className="rounded-[var(--radius-lg,5px)] border border-line-strong bg-surface-2 p-3">
          <p className="font-mono text-xs uppercase tracking-wider text-accent-ink">{entry.runningLabel}</p>
        </div>
      )}

      {ready && phase === "complete" && task && (
        <>
          <entry.Result task={task} />
          {task.costUsd > 0 && (
            <p className="font-mono text-[10px] uppercase tracking-wide text-text-3">Cost: ${task.costUsd.toFixed(4)}</p>
          )}
        </>
      )}

      {ready && phase === "failed" && task?.error && (
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
  );
}
