"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DET_SIGNAL_IDS, type DetSignalId, type DetSignalResult } from "@aeo/scoring";
import { loadAuditReport, type SavedAuditReport } from "@/lib/reports";
import { AuditReportView } from "./AuditReportView";
import { SiteAuditReportView } from "./SiteAuditReportView";

export function SavedReportClient({ id }: { id: string }) {
  const router = useRouter();
  const [report, setReport] = useState<SavedAuditReport | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void loadAuditReport(id).then((value) => { if (active) { setReport(value); setReady(true); } });
    return () => { active = false; };
  }, [id]);

  if (!ready) return <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10"><p className="wb-skeleton text-sm text-text-3">Loading saved report…</p></main>;
  if (!report) return <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10"><p className="font-mono text-xs uppercase tracking-wider text-text-3">Saved report</p><h1 className="mt-2 text-2xl font-semibold">Report unavailable</h1><p className="mt-3 text-sm text-text-2">This report was removed, browser storage was cleared, or it belongs to another browser.</p><Link href="/dashboard" className="mt-5 inline-block font-mono text-xs uppercase tracking-wider text-accent-ink hover:underline">← Back to dashboard</Link></main>;

  if (report.kind === "single") {
    const signals = Object.fromEntries(DET_SIGNAL_IDS.map((signalId) => [signalId, report.report.scores.signals[signalId]])) as Record<DetSignalId, DetSignalResult>;
    return <main className="flex flex-1 flex-col"><div className="mx-auto w-full max-w-4xl px-4 pt-6"><Link href="/dashboard" className="font-mono text-xs uppercase tracking-wider text-accent-ink hover:underline">← Back to dashboard</Link><p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-text-3">Saved locally · {new Date(report.createdAt).toLocaleString()}</p></div><AuditReportView phase={report.phase} page={report.report.page} signals={signals} scores={report.report.scores} findings={report.report.findings} rewrites={report.report.rewrites} error={report.error} onRetry={() => router.push(`/audit?url=${encodeURIComponent(report.report.page.url)}`)} /></main>;
  }

  const state = report.state;
  return <main className="flex flex-1 flex-col"><div className="mx-auto w-full max-w-4xl px-4 pt-6"><Link href="/dashboard" className="font-mono text-xs uppercase tracking-wider text-accent-ink hover:underline">← Back to dashboard</Link><p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-text-3">Saved locally · {new Date(report.createdAt).toLocaleString()}</p></div><SiteAuditReportView phase={report.phase} rootUrl={state.rootUrl} method={state.method} discoveredPages={state.discoveredPages} truncated={state.truncated} pages={state.pages} pageOrder={state.pageOrder} rollup={state.rollup} stoppedEarly={state.stoppedEarly} error={state.error} onRetry={() => router.push(`/audit/site?url=${encodeURIComponent(state.rootUrl ?? "")}`)} /></main>;
}
