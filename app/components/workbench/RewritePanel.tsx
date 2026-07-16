"use client";

import type { AuditRewrites, RewriteHunk } from "@/lib/audit/types";
import { DiffHunk, type HunkStatus } from "@/app/components/ui/DiffHunk";

type Props = {
  rewrites: AuditRewrites | null;
  statuses: Record<string, HunkStatus>;
  onAccept: (hunk: RewriteHunk) => void;
  onReject: (hunk: RewriteHunk) => void;
  onReset: (hunk: RewriteHunk) => void;
};

/**
 * Before/after rewrite hunks with per-hunk accept/reject. Accepting a hunk
 * applies its text to the working document (parent) and triggers an estimated
 * re-score.
 */
export function RewritePanel({ rewrites, statuses, onAccept, onReject, onReset }: Props) {
  if (!rewrites || rewrites.hunks.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[13px] text-text-3">
        Rewrites stream in after scoring. Run an audit to generate answer-first intro and section rewrites.
      </p>
    );
  }

  const accepted = rewrites.hunks.filter((h) => statuses[h.id] === "accepted").length;

  return (
    <div className="flex flex-col gap-2.5 p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-text-3">
        {accepted} of {rewrites.hunks.length} applied
      </p>
      {rewrites.hunks.map((hunk) => (
        <DiffHunk
          key={hunk.id}
          hunk={hunk}
          status={statuses[hunk.id] ?? "pending"}
          onAccept={() => onAccept(hunk)}
          onReject={() => onReject(hunk)}
          onReset={() => onReset(hunk)}
        />
      ))}
    </div>
  );
}
