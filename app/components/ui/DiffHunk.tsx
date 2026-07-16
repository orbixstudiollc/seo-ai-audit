"use client";

import type { RewriteHunk } from "@/lib/audit/types";
import { SIGNAL_META } from "@/lib/audit/signalMeta";
import { Button } from "./Button";

export type HunkStatus = "pending" | "accepted" | "rejected";

type Props = {
  hunk: RewriteHunk;
  status: HunkStatus;
  onAccept: () => void;
  onReject: () => void;
  onReset: () => void;
};

const KIND_LABEL: Record<RewriteHunk["kind"], string> = {
  intro: "Intro",
  section: "Section",
  quotable: "Quotable",
};

/**
 * One before/after rewrite hunk with accept/reject. Accepting mutates the
 * working document (handled by the parent) and triggers an estimated re-score.
 */
export function DiffHunk({ hunk, status, onAccept, onReject, onReset }: Props) {
  const target = hunk.targetSignal ? SIGNAL_META[hunk.targetSignal] : null;

  return (
    <article
      className={`rounded-[var(--radius-lg,5px)] border bg-surface-1 ${
        status === "accepted"
          ? "border-[var(--diff-add-line)]"
          : status === "rejected"
            ? "border-line opacity-60"
            : "border-line"
      }`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="flex items-center gap-2">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-text-3">
            {KIND_LABEL[hunk.kind]}
          </span>
          <span className="text-xs font-medium text-text-1">{hunk.label}</span>
        </span>
        {target && (
          <span className="font-mono text-[10px] text-text-3">→ {target.label}</span>
        )}
      </header>

      <div className="grid gap-px bg-line sm:grid-cols-2">
        <div className="bg-[var(--diff-del-tint)] px-3 py-2">
          <p className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-text-3">Before</p>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-2 line-through decoration-[var(--diff-del-line)] decoration-1">
            {hunk.before}
          </p>
        </div>
        <div className="bg-[var(--diff-add-tint)] px-3 py-2">
          <p className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-text-3">After</p>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-1">{hunk.after}</p>
        </div>
      </div>

      <footer className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-3">
          {status === "accepted" ? "Applied to working doc" : status === "rejected" ? "Dismissed" : "Review"}
        </span>
        {status === "pending" ? (
          <span className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={onReject}>
              Reject
            </Button>
            <Button size="sm" variant="primary" onClick={onAccept}>
              Accept
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={onReset}>
            Undo
          </Button>
        )}
      </footer>
    </article>
  );
}
