"use client";

import { useEffect, useRef, useState } from "react";
import { useSiteAuditStream } from "@/app/hooks/useSiteAuditStream";
import { useLocalSettings } from "@/app/hooks/useLocalSettings";
import { addHistoryRecord, createHistoryId, loadHistory, notifyHistoryChanged, storeHistory } from "@/lib/history";
import { SiteAuditReportView } from "./SiteAuditReportView";
import { SavedAuditActions } from "./SavedAuditActions";

type Props = {
  url: string;
};

/** Live container: streams `url` through /api/audit/bulk and renders the progressive site report. */
export function SiteAuditRunner({ url }: Props) {
  const stream = useSiteAuditStream(url);
  const { settings, ready } = useLocalSettings();
  const savedIdRef = useRef<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const canSave = stream.phase === "done" || (stream.phase === "error" && stream.rollup !== null);
    if (!ready || !settings.autoSaveAudits || !canSave || !stream.rollup) return;
    const createdAt = new Date().toISOString();
    const id = createHistoryId("site", url, createdAt);
    if (savedIdRef.current) return;
    try {
      const next = addHistoryRecord(loadHistory(window.localStorage), {
        id, version: 1, url, title: new URL(url).hostname, mode: "site", createdAt,
        status: stream.phase === "done" && !stream.stoppedEarly ? "complete" : "partial",
        scores: stream.rollup.avgScores, pageCount: stream.rollup.pagesAudited,
      }, settings.historyLimit);
      storeHistory(window.localStorage, next); notifyHistoryChanged(); savedIdRef.current = id; queueMicrotask(() => setSaved(true));
    } catch { /* Audit display must never fail because storage is unavailable. */ }
  }, [ready, settings, stream.phase, stream.rollup, stream.stoppedEarly, url]);

  return (
    <>
      <SiteAuditReportView phase={stream.phase} rootUrl={stream.rootUrl} method={stream.method} discoveredPages={stream.discoveredPages} truncated={stream.truncated} pages={stream.pages} pageOrder={stream.pageOrder} rollup={stream.rollup} stoppedEarly={stream.stoppedEarly} error={stream.error} onRetry={stream.retry} />
      <SavedAuditActions saved={saved} />
    </>
  );
}
