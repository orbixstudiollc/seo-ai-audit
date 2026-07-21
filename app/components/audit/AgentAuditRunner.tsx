"use client";

import { useEffect, useRef, useState } from "react";
import { useAgentStream } from "@/app/hooks/useAgentStream";
import { useLocalSettings } from "@/app/hooks/useLocalSettings";
import { addHistoryRecord, createHistoryId, loadHistory, notifyHistoryChanged, storeHistory, type AuditHistoryRecord } from "@/lib/history";
import { saveAuditReport, type SavedAgentReport } from "@/lib/reports";
import { saveCloudAudit } from "@/lib/cloud/history";
import { AgentReportView } from "./AgentReportView";

type Props = {
  url: string;
};

const compactText = (value: string) => value.slice(0, 500);

/**
 * Live container: streams `url` through /api/audit/agent and renders the
 * progressive agent report. Persistence mirrors SiteAuditRunner: a history
 * record while the run is live/settled, then a SavedAgentReport once it
 * reaches "done"/"error" — re-saved whenever a handoff skill resolves after
 * done (status upgrades partial -> complete as pendingTaskIds empties).
 * Nothing is written during "idle"/"planning"/"confirm" — the confirm gate
 * is a dry run the user can still walk away from with nothing recorded.
 */
export function AgentAuditRunner({ url }: Props) {
  const stream = useAgentStream(url);
  const { settings, ready } = useLocalSettings();
  const [historyRun] = useState(() => {
    const createdAt = new Date().toISOString();
    return { createdAt, id: createHistoryId("agent", url, createdAt) };
  });
  const lastRecordRef = useRef("");
  const lastSavedStateRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !settings.autoSaveAudits) return;
    if (stream.phase === "idle" || stream.phase === "planning" || stream.phase === "confirm") return;
    try {
      const status = stream.phase === "error"
        ? "failed"
        : stream.phase === "done" ? (stream.pendingTaskIds.length > 0 ? "partial" : "complete") : "started";
      const record: AuditHistoryRecord = {
        id: historyRun.id, version: 4, url, title: new URL(url).hostname,
        mode: "agent" as const, createdAt: historyRun.createdAt, status,
        scores: null,
        details: {
          kind: "agent",
          skillsRun: stream.skills.filter((row) => row.status !== "planned").length,
          skillsFailed: stream.skills.filter((row) => row.status === "failed").length,
          pendingCount: stream.pendingTaskIds.length,
          errorMessage: stream.error ? compactText(stream.error.message) : undefined,
        },
      };
      const serialized = JSON.stringify(record);
      if (serialized === lastRecordRef.current) return;
      const current = loadHistory(window.localStorage);
      record.reportAvailable = current.find((item) => item.id === historyRun.id)?.reportAvailable;
      const next = addHistoryRecord(current, record, settings.historyLimit);
      storeHistory(window.localStorage, next); notifyHistoryChanged(); lastRecordRef.current = serialized;

      if (stream.phase !== "done" && stream.phase !== "error") return;

      const reportState = {
        phase: stream.phase, runId: stream.runId, businessType: stream.businessType,
        skills: stream.skills, actionPlan: stream.actionPlan, pendingTaskIds: stream.pendingTaskIds,
        error: stream.error, planOnly: stream.planOnly,
      };
      const serializedState = JSON.stringify(reportState);
      if (serializedState === lastSavedStateRef.current) return;
      lastSavedStateRef.current = serializedState;

      const savedReport: SavedAgentReport = {
        version: 1, id: historyRun.id, kind: "agent", createdAt: historyRun.createdAt,
        phase: stream.phase, url, state: reportState,
      };
      void saveAuditReport(savedReport)
        .then(() => {
          const records = loadHistory(window.localStorage);
          const updated = records.map((item) => item.id === historyRun.id ? { ...item, reportAvailable: true } : item);
          storeHistory(window.localStorage, updated); notifyHistoryChanged();
          const cloudRecord = updated.find((item) => item.id === historyRun.id);
          if (cloudRecord) void saveCloudAudit(cloudRecord, savedReport);
        })
        .catch(() => { lastSavedStateRef.current = null; });
    } catch { /* Audit display must never fail because storage is unavailable. */ }
  }, [historyRun, ready, settings, stream, url]);

  return <AgentReportView url={url} {...stream} />;
}
