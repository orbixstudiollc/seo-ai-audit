"use client";

import Link from "next/link";

export function SavedAuditActions({ saved }: { saved: boolean }) {
  if (!saved) return null;
  return (
    <div role="status" className="mx-auto mb-6 flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 border border-accent-line bg-accent-tint px-4 py-3">
      <p className="text-sm font-medium text-text-1">Saved to your dashboard on this browser.</p>
      <div className="flex gap-4 font-mono text-xs uppercase tracking-wider"><Link className="text-accent-ink hover:underline" href="/dashboard">View dashboard</Link><Link className="text-text-2 hover:text-text-1 hover:underline" href="/">Run another audit</Link></div>
    </div>
  );
}

