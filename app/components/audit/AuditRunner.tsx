"use client";

import { useEffect, useRef, useState } from "react";
import { LENSES } from "@aeo/scoring";
import { useAuditStream } from "@/app/hooks/useAuditStream";
import { useLocalSettings } from "@/app/hooks/useLocalSettings";
import { addHistoryRecord, createHistoryId, loadHistory, notifyHistoryChanged, storeHistory, type AuditHistoryRecord } from "@/lib/history";
import { AuditReportView } from "./AuditReportView";
import { SavedAuditActions } from "./SavedAuditActions";

type Props = {
  url: string;
};

/** Live container: streams `url` through /api/audit and renders the progressive report. */
export function AuditRunner({ url }: Props) {
  const stream = useAuditStream(url);
  const { settings, ready } = useLocalSettings();
  const [historyRun] = useState(() => {
    const createdAt = new Date().toISOString();
    return { createdAt, id: createHistoryId("single", url, createdAt) };
  });
  const lastRecordRef = useRef("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!ready || !settings.autoSaveAudits) return;
    try {
      const scores = stream.scores
        ? Object.fromEntries(LENSES.map((lens) => [lens, stream.scores!.lenses[lens].score])) as Record<(typeof LENSES)[number], number>
        : null;
      const status = stream.phase === "done" ? "complete" : stream.phase === "error" ? (scores ? "partial" : "failed") : "started";
      const record: AuditHistoryRecord = {
        id: historyRun.id, version: 2, url, finalUrl: stream.page?.finalUrl,
        title: stream.page?.title || new URL(url).hostname, mode: "single" as const,
        createdAt: historyRun.createdAt, status, scores,
      };
      const serialized = JSON.stringify(record);
      if (serialized === lastRecordRef.current) return;
      const next = addHistoryRecord(loadHistory(window.localStorage), record, settings.historyLimit);
      storeHistory(window.localStorage, next); notifyHistoryChanged(); lastRecordRef.current = serialized;
      if (stream.phase === "done" || stream.phase === "error") queueMicrotask(() => setSaved(true));
    } catch { /* Audit display must never fail because storage is unavailable. */ }
  }, [historyRun, ready, settings, stream.phase, stream.page, stream.scores, url]);

  return (
    <>
      <AuditReportView phase={stream.phase} page={stream.page} signals={stream.signals} scores={stream.scores} findings={stream.findings} rewrites={stream.rewrites} error={stream.error} onRetry={stream.retry} />
      <SavedAuditActions saved={saved} />
    </>
  );
}
