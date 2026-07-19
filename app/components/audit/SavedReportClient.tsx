"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DET_SIGNAL_IDS, type DetSignalId, type DetSignalResult } from "@aeo/scoring";
import { loadAuditReport, type SavedAuditReport, type SavedSiteReport } from "@/lib/reports";
import { saveAuditReport } from "@/lib/reports";
import { loadCloudAuditReport, saveCloudAudit } from "@/lib/cloud/history";
import { addHistoryRecord, loadHistory, notifyHistoryChanged, storeHistory, type AuditHistoryRecord } from "@/lib/history";
import { consumeSiteAuditStream, siteAuditStreamReducer, type SiteAuditStreamState } from "@/app/hooks/useSiteAuditStream";
import { AuditReportView } from "./AuditReportView";
import { SiteAuditReportView } from "./SiteAuditReportView";
import { TechnicalSeoPanel } from "./TechnicalSeoPanel";

const compactText = (value: string) => value.slice(0, 500);

function persistedSiteState(state: SiteAuditStreamState): SavedSiteReport["state"] {
  return {
    rootUrl: state.rootUrl,
    method: state.method,
    discoveredPages: state.discoveredPages,
    truncated: state.truncated,
    pages: state.pages,
    pageOrder: state.pageOrder,
    rollup: state.rollup,
    stoppedEarly: state.stoppedEarly,
    error: state.error,
  };
}

function siteHistoryRecord(report: SavedSiteReport, state: SiteAuditStreamState): AuditHistoryRecord {
  const rootUrl = state.rootUrl ?? "https://invalid.local/";
  return {
    id: report.id,
    version: 4,
    url: rootUrl,
    title: (() => { try { return new URL(rootUrl).hostname; } catch { return rootUrl; } })(),
    mode: "site",
    createdAt: report.createdAt,
    status: state.phase === "error" || state.stoppedEarly ? "partial" : "complete",
    scores: state.rollup?.avgScores ?? null,
    pageCount: state.rollup?.pagesAudited,
    details: {
      kind: "site",
      pagesFailed: state.rollup?.pagesFailed ?? 0,
      worstPages: (state.rollup?.worstPages ?? []).slice(0, 5).map((page) => ({ ...page, title: compactText(page.title) })),
      commonFindings: (state.rollup?.commonFindings ?? []).slice(0, 5).map((finding) => ({ ...finding, issue: compactText(finding.issue) })),
      errorMessage: state.error ? compactText(state.error.message) : undefined,
    },
    reportAvailable: true,
  };
}

function SavedSiteReportClient({ report }: { report: SavedSiteReport }) {
  const router = useRouter();
  const controllerRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const [siteState, setSiteState] = useState<SiteAuditStreamState>(() => ({
    phase: report.phase,
    ...report.state,
    retryingFailed: false,
    retryPageUrls: [],
  }));

  useEffect(() => () => controllerRef.current?.abort(), []);

  const persist = useCallback(async (next: SiteAuditStreamState) => {
    const updatedReport: SavedSiteReport = {
      ...report,
      phase: next.phase === "error" ? "error" : "done",
      state: persistedSiteState(next),
    };
    await saveAuditReport(updatedReport).catch(() => undefined);
    const record = siteHistoryRecord(updatedReport, next);
    const current = loadHistory(window.localStorage);
    const records = current.some((item) => item.id === record.id)
      ? current.map((item) => item.id === record.id ? record : item)
      : addHistoryRecord(current, record, 500);
    storeHistory(window.localStorage, records);
    notifyHistoryChanged();
    await saveCloudAudit(record, updatedReport);
  }, [report]);

  const retryFailedPages = useCallback(() => {
    if (runningRef.current || !siteState.rootUrl) return;
    const urls = siteState.pageOrder.filter((url) => siteState.pages[url]?.phase === "error");
    if (urls.length === 0) return;

    runningRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    let next = siteAuditStreamReducer(siteState, { type: "retry-pages", urls });
    setSiteState(next);

    void consumeSiteAuditStream({ url: siteState.rootUrl, pages: urls }, controller.signal, (event) => {
      next = siteAuditStreamReducer(next, event);
      setSiteState(next);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      next = siteAuditStreamReducer(next, {
        type: "site:error",
        kind: "server",
        message: error instanceof Error ? error.message : "Failed-page retry was interrupted.",
      });
      setSiteState(next);
    }).finally(() => {
      runningRef.current = false;
      controllerRef.current = null;
      if (!controller.signal.aborted && (next.phase === "done" || next.phase === "error")) void persist(next);
    });
  }, [persist, siteState]);

  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-4xl px-4 pt-6">
        <Link href="/dashboard" className="font-mono text-xs uppercase tracking-wider text-accent-ink hover:underline">← Back to dashboard</Link>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-text-3">Saved report · {new Date(report.createdAt).toLocaleString()}</p>
      </div>
      <SiteAuditReportView
        phase={siteState.phase}
        rootUrl={siteState.rootUrl}
        method={siteState.method}
        discoveredPages={siteState.discoveredPages}
        truncated={siteState.truncated}
        pages={siteState.pages}
        pageOrder={siteState.pageOrder}
        rollup={siteState.rollup}
        stoppedEarly={siteState.stoppedEarly}
        error={siteState.error}
        onRetry={() => router.push(`/audit/site?url=${encodeURIComponent(siteState.rootUrl ?? "")}`)}
        onRetryFailed={retryFailedPages}
        retryingFailed={siteState.retryingFailed}
      />
      {siteState.rootUrl && <div className="mx-auto w-full max-w-4xl px-4 pb-6 sm:px-6 lg:px-8"><TechnicalSeoPanel auditId={report.id} rootUrl={siteState.rootUrl} limit={500} /></div>}
    </main>
  );
}

export function SavedReportClient({ id }: { id: string }) {
  const router = useRouter();
  const [report, setReport] = useState<SavedAuditReport | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void loadAuditReport(id).then(async (localReport) => {
      const value = localReport ?? await loadCloudAuditReport(id);
      if (!localReport && value) void saveAuditReport(value).catch(() => undefined);
      if (active) { setReport(value); setReady(true); }
    });
    return () => { active = false; };
  }, [id]);

  if (!ready) return <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10"><p className="wb-skeleton text-sm text-text-3">Loading saved report…</p></main>;
  if (!report) return <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10"><p className="font-mono text-xs uppercase tracking-wider text-text-3">Saved report</p><h1 className="mt-2 text-2xl font-semibold">Report unavailable</h1><p className="mt-3 text-sm text-text-2">This report was removed, cloud storage is unavailable, or it belongs to another audit workspace.</p><Link href="/dashboard" className="mt-5 inline-block font-mono text-xs uppercase tracking-wider text-accent-ink hover:underline">← Back to dashboard</Link></main>;

  if (report.kind === "single") {
    const signals = Object.fromEntries(DET_SIGNAL_IDS.map((signalId) => [signalId, report.report.scores.signals[signalId]])) as Record<DetSignalId, DetSignalResult>;
    return <main className="flex flex-1 flex-col"><div className="mx-auto w-full max-w-4xl px-4 pt-6"><Link href="/dashboard" className="font-mono text-xs uppercase tracking-wider text-accent-ink hover:underline">← Back to dashboard</Link><p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-text-3">Saved report · {new Date(report.createdAt).toLocaleString()}</p></div><AuditReportView phase={report.phase} page={report.report.page} signals={signals} scores={report.report.scores} findings={report.report.findings} rewrites={report.report.rewrites} error={report.error} onRetry={() => router.push(`/audit?url=${encodeURIComponent(report.report.page.url)}`)} /></main>;
  }

  return <SavedSiteReportClient report={report} />;
}
