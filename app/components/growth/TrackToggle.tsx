"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/Button";
import { trackSite, untrackSite, type GrowthClientReason } from "@/lib/growth/client";

const ERROR_COPY: Partial<Record<GrowthClientReason, string>> = {
  audit_required: "Run an audit first",
  limit_reached: "Limit reached (10)",
  rate_limit: "Rate limited — try again soon",
};
const FALLBACK_ERROR = "Couldn't update tracking";

type Props = {
  /** Exact url sent to the tracked-sites routes (§13). */
  url: string;
  tracked: boolean;
  /** Fires only after the API confirmed the change. */
  onTrackedChange: (tracked: boolean) => void;
};

/**
 * Per-site daily-tracking toggle. Calls the §13 routes itself and keeps its
 * own pending/error state; the parent only learns about confirmed changes.
 */
export function TrackToggle({ url, tracked, onTrackedChange }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (next: boolean) => {
    setPending(true);
    setError(null);
    const result = next ? await trackSite(url) : await untrackSite(url);
    setPending(false);
    if (result.ok) onTrackedChange(next);
    else setError(ERROR_COPY[result.reason] ?? FALLBACK_ERROR);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tracked ? (
        <>
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-2">
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: "var(--score-strong)" }}
            />
            Tracking · daily
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            aria-busy={pending}
            className="text-[10px]"
            onClick={() => void run(false)}
          >
            Untrack
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          aria-busy={pending}
          className="text-[10px]"
          onClick={() => void run(true)}
        >
          Track daily
        </Button>
      )}
      {error && (
        <span
          role="status"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] text-text-1"
          style={{ backgroundColor: "var(--score-weak-tint)" }}
        >
          <span aria-hidden="true" style={{ color: "var(--score-weak)" }}>
            ▼
          </span>
          {error}
        </span>
      )}
    </div>
  );
}
