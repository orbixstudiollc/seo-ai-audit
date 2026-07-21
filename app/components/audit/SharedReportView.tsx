"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { DET_SIGNAL_IDS, type DetSignalId, type DetSignalResult } from "@aeo/scoring";
import type { SavedAuditReport } from "@/lib/reports";
import { agentStreamReducer, type AgentStreamState } from "@/app/hooks/useAgentStream";
import type { SkillTask } from "@/lib/skills/types";
import { AgentReportView } from "./AgentReportView";
import { AuditReportView } from "./AuditReportView";
import { SiteAuditReportView } from "./SiteAuditReportView";

const NOOP = () => undefined;

/** Read-only render of a publicly shared stored report — no retry, no persistence
 * (a resolved handoff task still updates the on-screen state, just never saves). */
export function SharedReportView({ report }: { report: SavedAuditReport }) {
  const router = useRouter();
  const [agentState, setAgentState] = useState<AgentStreamState | null>(report.kind === "agent" ? report.state : null);
  const handlePendingResolved = useCallback((taskId: string, task: SkillTask) => {
    setAgentState((prev) => (prev ? agentStreamReducer(prev, { type: "pending-resolved", taskId, task }) : prev));
  }, []);

  const sourceUrl = report.kind === "single" ? report.report.page.url : report.kind === "agent" ? report.url : report.state.rootUrl;
  const header = (
    <div className="mx-auto w-full max-w-4xl px-4 pt-6">
      <p className="font-mono text-[10px] uppercase tracking-wider text-text-3">
        Shared report · {new Date(report.createdAt).toLocaleString()} · read-only
      </p>
      <Link href="/" className="mt-2 inline-block font-mono text-xs uppercase tracking-wider text-accent-ink hover:underline">
        Run your own audit →
      </Link>
    </div>
  );

  if (report.kind === "single") {
    const signals = Object.fromEntries(DET_SIGNAL_IDS.map((signalId) => [signalId, report.report.scores.signals[signalId]])) as Record<DetSignalId, DetSignalResult>;
    return (
      <main className="flex flex-1 flex-col">
        {header}
        <AuditReportView
          phase={report.phase}
          page={report.report.page}
          signals={signals}
          scores={report.report.scores}
          findings={report.report.findings}
          rewrites={report.report.rewrites}
          error={report.error}
          onRetry={() => router.push(`/audit?url=${encodeURIComponent(sourceUrl ?? "")}`)}
          retryLabel="Run a fresh audit"
        />
      </main>
    );
  }

  if (report.kind === "agent") {
    const state = agentState ?? report.state;
    return (
      <main className="flex flex-1 flex-col">
        {header}
        <AgentReportView url={report.url} {...state} confirm={NOOP} retry={NOOP} resolvePending={handlePendingResolved} />
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      {header}
      <SiteAuditReportView
        phase={report.phase}
        rootUrl={report.state.rootUrl}
        method={report.state.method}
        discoveredPages={report.state.discoveredPages}
        truncated={report.state.truncated}
        pages={report.state.pages}
        pageOrder={report.state.pageOrder}
        rollup={report.state.rollup}
        stoppedEarly={report.state.stoppedEarly}
        error={report.state.error}
        onRetry={() => router.push(`/audit/site?url=${encodeURIComponent(sourceUrl ?? "")}`)}
      />
    </main>
  );
}
