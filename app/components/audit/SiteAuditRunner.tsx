"use client";

import { useEffect, useRef, useState } from "react";
import { useSiteAuditStream } from "@/app/hooks/useSiteAuditStream";
import { useLocalSettings } from "@/app/hooks/useLocalSettings";
import { addHistoryRecord, createHistoryId, loadHistory, notifyHistoryChanged, storeHistory, type AuditHistoryRecord } from "@/lib/history";
import { SiteAuditReportView } from "./SiteAuditReportView";
import { SavedAuditActions } from "./SavedAuditActions";

type Props = {
  url: string;
};

/** Live container: streams `url` through /api/audit/bulk and renders the progressive site report. */
export function SiteAuditRunner({ url }: Props) {
  const stream = useSiteAuditStream(url);
  const { settings, ready } = useLocalSettings();
  const [historyRun] = useState(() => {
    const createdAt = new Date().toISOString();
    return { createdAt, id: createHistoryId("site", url, createdAt) };
  });
  const lastRecordRef = useRef("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!ready || !settings.autoSaveAudits) return;
    try {
      const status = stream.phase === "done"
        ? (stream.stoppedEarly ? "partial" : "complete")
        : stream.phase === "error" ? (stream.rollup ? "partial" : "failed") : "started";
      const record: AuditHistoryRecord = {
        id: historyRun.id, version: 2, url, title: new URL(url).hostname,
        mode: "site" as const, createdAt: historyRun.createdAt, status,
        scores: stream.rollup?.avgScores ?? null, pageCount: stream.rollup?.pagesAudited,
      };
      const serialized = JSON.stringify(record);
      if (serialized === lastRecordRef.current) return;
      const next = addHistoryRecord(loadHistory(window.localStorage), record, settings.historyLimit);
      storeHistory(window.localStorage, next); notifyHistoryChanged(); lastRecordRef.current = serialized;
      if (stream.phase === "done" || stream.phase === "error") queueMicrotask(() => setSaved(true));
    } catch { /* Audit display must never fail because storage is unavailable. */ }
  }, [historyRun, ready, settings, stream.phase, stream.rollup, stream.stoppedEarly, url]);

  return (
    <>
      <SiteAuditReportView phase={stream.phase} rootUrl={stream.rootUrl} method={stream.method} discoveredPages={stream.discoveredPages} truncated={stream.truncated} pages={stream.pages} pageOrder={stream.pageOrder} rollup={stream.rollup} stoppedEarly={stream.stoppedEarly} error={stream.error} onRetry={stream.retry} />
      <SavedAuditActions saved={saved} />
    </>
  );
}
