"use client";

import { useEffect, useRef, useState } from "react";
import { useSiteAuditStream } from "@/app/hooks/useSiteAuditStream";
import { useLocalSettings } from "@/app/hooks/useLocalSettings";
import { addHistoryRecord, createHistoryId, loadHistory, notifyHistoryChanged, storeHistory, type AuditHistoryRecord } from "@/lib/history";
import { pruneAuditReports, saveAuditReport } from "@/lib/reports";
import { saveCloudAudit } from "@/lib/cloud/history";
import { SiteAuditReportView } from "./SiteAuditReportView";
import { SavedAuditActions } from "./SavedAuditActions";

type Props = {
  url: string;
};

const compactText = (value: string) => value.slice(0, 500);

/** Live container: streams `url` through /api/audit/bulk and renders the progressive site report. */
export function SiteAuditRunner({ url }: Props) {
  const stream = useSiteAuditStream(url);
  const { settings, ready } = useLocalSettings();
  const [historyRun] = useState(() => {
    const createdAt = new Date().toISOString();
    return { createdAt, id: createHistoryId("site", url, createdAt) };
  });
  const lastRecordRef = useRef("");
  const reportSavedRef = useRef(false);
  const cloudStartedRef = useRef(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!ready || !settings.autoSaveAudits) return;
    try {
      const status = stream.phase === "done"
        ? (stream.stoppedEarly ? "partial" : "complete")
        : stream.phase === "error" ? (stream.rollup ? "partial" : "failed") : "started";
      const record: AuditHistoryRecord = {
        id: historyRun.id, version: 4, url, title: new URL(url).hostname,
        mode: "site" as const, createdAt: historyRun.createdAt, status,
        scores: stream.rollup?.avgScores ?? null, pageCount: stream.rollup?.pagesAudited,
        details: {
          kind: "site",
          pagesFailed: stream.rollup?.pagesFailed ?? 0,
          worstPages: (stream.rollup?.worstPages ?? []).slice(0, 5).map((page) => ({ ...page, title: compactText(page.title) })),
          commonFindings: (stream.rollup?.commonFindings ?? []).slice(0, 5).map((finding) => ({ ...finding, issue: compactText(finding.issue) })),
          errorMessage: stream.error ? compactText(stream.error.message) : undefined,
        },
      };
      const serialized = JSON.stringify(record);
      if (serialized === lastRecordRef.current) return;
      const current = loadHistory(window.localStorage);
      record.reportAvailable = current.find((item) => item.id === historyRun.id)?.reportAvailable;
      const next = addHistoryRecord(current, record, settings.historyLimit);
      storeHistory(window.localStorage, next); notifyHistoryChanged(); lastRecordRef.current = serialized;
      void pruneAuditReports(new Set(next.map((item) => item.id))).catch(() => undefined);
      if (!cloudStartedRef.current) {
        cloudStartedRef.current = true;
        void saveCloudAudit(record).then((savedToCloud) => { if (!savedToCloud) cloudStartedRef.current = false; });
      }
      if (stream.phase === "done" || stream.phase === "error") {
        if (!reportSavedRef.current && stream.rollup) {
          reportSavedRef.current = true;
          const state = {
            rootUrl: stream.rootUrl, method: stream.method, discoveredPages: stream.discoveredPages,
            truncated: stream.truncated, pages: stream.pages, pageOrder: stream.pageOrder,
            rollup: stream.rollup, stoppedEarly: stream.stoppedEarly, error: stream.error,
          };
          const savedReport = { version: 1, id: historyRun.id, kind: "site", createdAt: historyRun.createdAt, phase: stream.phase, state } as const;
          void saveAuditReport(savedReport)
            .then(() => {
              const records = loadHistory(window.localStorage);
              const updated = records.map((item) => item.id === historyRun.id ? { ...item, reportAvailable: true } : item);
              storeHistory(window.localStorage, updated); notifyHistoryChanged();
              const cloudRecord = updated.find((item) => item.id === historyRun.id);
              if (cloudRecord) void saveCloudAudit(cloudRecord, savedReport);
              setSaved(true);
            }).catch(() => { reportSavedRef.current = false; setSaved(true); });
        } else if (!stream.rollup) {
          void saveCloudAudit(record);
          queueMicrotask(() => setSaved(true));
        }
      }
    } catch { /* Audit display must never fail because storage is unavailable. */ }
  }, [historyRun, ready, settings, stream, url]);

  return (
    <>
      <SiteAuditReportView phase={stream.phase} rootUrl={stream.rootUrl} method={stream.method} discoveredPages={stream.discoveredPages} truncated={stream.truncated} pages={stream.pages} pageOrder={stream.pageOrder} rollup={stream.rollup} stoppedEarly={stream.stoppedEarly} error={stream.error} onRetry={stream.retry} />
      <SavedAuditActions saved={saved} />
    </>
  );
}
