"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  HISTORY_CHANGED_EVENT,
  loadHistory,
  mergeHistoryRecords,
  storeHistory,
  type AuditHistoryRecord,
} from "@/lib/history";
import { loadCloudHistory } from "@/lib/cloud/history";
import { ACCOUNT_OWNER_CHANGED_EVENT } from "@/lib/auth/events";
import { useLocalSettings } from "@/app/hooks/useLocalSettings";
import { groupByDomain, needsAttention, summarize } from "@/lib/growth/aggregate";
import { scoreBand } from "@/lib/audit/scoreScale";
import { Card } from "@/app/components/ui/Card";
import { SiteGrowthCard } from "./SiteGrowthCard";

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-line bg-surface-1 px-4 py-3">
      <span className="block font-mono text-[9px] uppercase tracking-wider text-text-3">{label}</span>
      <strong className="mt-1 block font-mono text-xl tabular-nums text-text-1">{value}</strong>
    </div>
  );
}

/**
 * G1 Growth tab: per-domain progress computed client-side from the same
 * merged local+cloud history the History tab uses. Read-only — the History
 * tab keeps ownership of mutation (remove/clear) and the one-time cloud
 * migration, so the two tabs never race on writes.
 */
export function GrowthOverview() {
  const [records, setRecords] = useState<AuditHistoryRecord[]>([]);
  const [ready, setReady] = useState(false);
  const { settings } = useLocalSettings();

  useEffect(() => {
    let active = true;
    const syncLocal = () => {
      setRecords(loadHistory(window.localStorage));
      setReady(true);
    };
    const hydrate = async () => {
      syncLocal();
      const cloud = await loadCloudHistory();
      if (!active || cloud === null) return;
      const merged = mergeHistoryRecords(cloud, loadHistory(window.localStorage), settings.historyLimit);
      storeHistory(window.localStorage, merged);
      setRecords(merged);
    };
    void hydrate();
    const syncAccount = () => void hydrate();
    window.addEventListener(HISTORY_CHANGED_EVENT, syncLocal);
    window.addEventListener("storage", syncLocal);
    window.addEventListener(ACCOUNT_OWNER_CHANGED_EVENT, syncAccount);
    return () => {
      active = false;
      window.removeEventListener(HISTORY_CHANGED_EVENT, syncLocal);
      window.removeEventListener("storage", syncLocal);
      window.removeEventListener(ACCOUNT_OWNER_CHANGED_EVENT, syncAccount);
    };
  }, [settings.historyLimit]);

  const groups = useMemo(() => groupByDomain(records), [records]);
  const attention = useMemo(() => needsAttention(groups), [groups]);
  const summary = useMemo(() => summarize(groups), [groups]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-text-3">Audit workspace</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Growth overview</h1>
          <p className="mt-2 max-w-xl text-sm text-text-2">
            Day-over-day progress for every site you audit — scores, deltas, and what needs
            attention next.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex h-9 items-center bg-text-1 px-4 font-mono text-xs font-medium uppercase tracking-wider text-surface-1 hover:bg-accent-ink"
        >
          New audit
        </Link>
      </div>

      {!ready ? (
        <p className="wb-skeleton p-6 text-sm text-text-3">Loading growth data…</p>
      ) : groups.length === 0 ? (
        <Card bodyClassName="p-10 text-center">
          <h2 className="font-semibold">No sites yet</h2>
          <p className="mt-2 text-sm text-text-2">
            Run your first audit and this page becomes your growth home: score trends per site,
            drops flagged automatically, and re-audits one click away.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block font-mono text-xs uppercase tracking-wider text-accent-ink hover:underline"
          >
            Start an audit →
          </Link>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryTile label="Sites" value={String(summary.domainCount)} />
            <SummaryTile label="Audits" value={String(summary.auditCount)} />
            <SummaryTile
              label="Avg latest score"
              value={summary.averageLatestScore === null ? "—" : String(summary.averageLatestScore)}
            />
            <SummaryTile
              label="Last activity"
              value={
                summary.lastActivityAt ? new Date(summary.lastActivityAt).toLocaleDateString() : "—"
              }
            />
          </div>

          {attention.length > 0 && (
            <Card label="Needs attention" labelAs="h2" bodyClassName="bg-surface-2">
              <ul className="divide-y divide-line">
                {attention.map((group) => (
                  <li key={group.domain} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <span className="min-w-0 truncate text-sm font-medium text-text-1">{group.domain}</span>
                    <span className="font-mono text-[11px] tabular-nums text-text-2">
                      <span aria-hidden="true" style={{ color: "var(--score-weak)" }}>▼ </span>
                      {group.delta !== null && group.delta < 0
                        ? `${group.delta} pts since previous audit`
                        : "latest audit failed"}
                    </span>
                    <Link
                      href={
                        group.latest.mode === "site"
                          ? `/audit/site?url=${encodeURIComponent(group.latest.url)}`
                          : `/audit?url=${encodeURIComponent(group.latest.url)}`
                      }
                      className="font-mono text-[10px] uppercase tracking-wider text-accent-ink hover:underline"
                    >
                      Re-audit
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <section aria-label="Sites">
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {groups.map((group) => (
                <SiteGrowthCard key={group.domain} group={group} />
              ))}
            </ul>
          </section>

          {summary.averageLatestScore !== null && (
            <p className="text-center font-mono text-[10px] uppercase tracking-wider text-text-3">
              Overall health{" "}
              <span style={{ color: scoreBand(summary.averageLatestScore).colorVar }}>
                {scoreBand(summary.averageLatestScore).label}
              </span>{" "}
              · daily automatic snapshots arrive with tracked sites (G2)
            </p>
          )}
        </>
      )}
    </main>
  );
}
