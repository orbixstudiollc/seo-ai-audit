"use client";

import { useEffect, useRef, useState } from "react";
import { LENSES } from "@aeo/scoring";
import { useAuditStream } from "@/app/hooks/useAuditStream";
import { useLocalSettings } from "@/app/hooks/useLocalSettings";
import { addHistoryRecord, createHistoryId, loadHistory, notifyHistoryChanged, storeHistory } from "@/lib/history";
import { AuditReportView } from "./AuditReportView";
import { SavedAuditActions } from "./SavedAuditActions";

type Props = {
  url: string;
};

/** Live container: streams `url` through /api/audit and renders the progressive report. */
export function AuditRunner({ url }: Props) {
  const stream = useAuditStream(url);
  const { settings, ready } = useLocalSettings();
  const savedIdRef = useRef<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const canSave = stream.phase === "done" || (stream.phase === "error" && stream.scores !== null);
    if (!ready || !settings.autoSaveAudits || !canSave || !stream.page || !stream.scores) return;
    const createdAt = stream.page.fetchedAt;
    const id = createHistoryId("single", url, createdAt);
    if (savedIdRef.current === id) return;
    try {
      const scores = Object.fromEntries(LENSES.map((lens) => [lens, stream.scores!.lenses[lens].score])) as Record<(typeof LENSES)[number], number>;
      const next = addHistoryRecord(loadHistory(window.localStorage), {
        id, version: 1, url, finalUrl: stream.page.finalUrl, title: stream.page.title || new URL(url).hostname,
        mode: "single", createdAt, status: stream.phase === "done" ? "complete" : "partial", scores,
      }, settings.historyLimit);
      storeHistory(window.localStorage, next); notifyHistoryChanged(); savedIdRef.current = id; queueMicrotask(() => setSaved(true));
    } catch { /* Audit display must never fail because storage is unavailable. */ }
  }, [ready, settings, stream.phase, stream.page, stream.scores, url]);

  return (
    <>
      <AuditReportView phase={stream.phase} page={stream.page} signals={stream.signals} scores={stream.scores} findings={stream.findings} rewrites={stream.rewrites} error={stream.error} onRetry={stream.retry} />
      <SavedAuditActions saved={saved} />
    </>
  );
}
