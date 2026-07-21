"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { averageScore } from "@/lib/history";
import { loadAuditReport, type SavedAuditReport } from "@/lib/reports";
import { loadCloudAuditReport } from "@/lib/cloud/history";
import { useMergedHistory } from "@/app/hooks/useMergedHistory";
import { groupByDomain, type DomainGroup } from "@/lib/growth/aggregate";
import { domainIssueTrend, diffActionPlans, type ActionPlanDiff } from "@/lib/growth/burndown";
import { seriesScores } from "@/lib/growth/series";
import { fetchGrowthSeries, listTrackedSites } from "@/lib/growth/client";
import type { GrowthSnapshot } from "@/lib/growth/types";
import { actionPlanForReport, actionPlanForSite, type ActionPlan } from "@/lib/skills/actionPlan";
import type { TechnicalSeoPage } from "@/lib/dataforseo/types";
import { scoreBand } from "@/lib/audit/scoreScale";
import { Card } from "@/app/components/ui/Card";
import { Button } from "@/app/components/ui/Button";
import { ActionPlanPanel } from "@/app/components/audit/ActionPlanPanel";
import { TechnicalSeoPanel } from "@/app/components/audit/TechnicalSeoPanel";
import { HUB_SKILL_IDS, SKILL_REGISTRY } from "@/app/components/skills/registry";
import { SkillPanel } from "@/app/components/skills/SkillPanel";
import { ComparePanel } from "@/app/components/skills/ComparePanel";
import { DeltaChip } from "./SiteGrowthCard";
import { LensScoreGrid } from "./LensScoreGrid";
import { TrackToggle } from "./TrackToggle";
import { TrendSparkline } from "./TrendSparkline";

/** Two reportable records for a domain: the current one and, if it exists, the one before it. */
function reportableRecords(group: DomainGroup): { latest: DomainGroup["latest"] | null; previous: DomainGroup["latest"] | null } {
  const reportable = group.records.filter((record) => record.reportAvailable);
  return { latest: reportable[0] ?? null, previous: reportable[1] ?? null };
}

async function loadReport(id: string): Promise<SavedAuditReport | null> {
  return (await loadAuditReport(id)) ?? (await loadCloudAuditReport(id));
}

/** Action plan for one saved report; `technicalPages` only affects site-kind reports.
 * Agent reports already carry their own plan from the run's rollup (§9/§10) — no re-synthesis. */
function planFor(report: SavedAuditReport, technicalPages: readonly TechnicalSeoPage[] | null): ActionPlan | null {
  if (report.kind === "single") return actionPlanForReport(report.report, report.createdAt);
  if (report.kind === "agent") return report.state.actionPlan;
  return actionPlanForSite(report.state.rootUrl ?? "", report.state.rollup, report.createdAt, technicalPages);
}

/**
 * G3 site hub: one domain's growth trend, audit history, and current action
 * plan in one place, plus (SK3) the agent audit entry point and the
 * per-domain skill checks (SkillPanel, generalized in SK1/SK2).
 */
export function SiteHubClient({ host }: { host: string }) {
  const router = useRouter();
  const { records, ready } = useMergedHistory();
  const [trackedUrls, setTrackedUrls] = useState<ReadonlySet<string> | null>(null);
  const [dailySeries, setDailySeries] = useState<GrowthSnapshot[] | null>(null);
  const [latestReport, setLatestReport] = useState<SavedAuditReport | null>(null);
  const [previousReport, setPreviousReport] = useState<SavedAuditReport | null>(null);
  const [technicalPages, setTechnicalPages] = useState<TechnicalSeoPage[] | null>(null);
  const requestedTrackUrl = useRef<string | null>(null);

  const group = useMemo(() => groupByDomain(records).find((candidate) => candidate.domain === host) ?? null, [records, host]);
  const { latest: latestRecord, previous: previousRecord } = useMemo(
    () => (group ? reportableRecords(group) : { latest: null, previous: null }),
    [group],
  );
  const trackUrl = useMemo(() => {
    if (!group || !trackedUrls) return group?.latest.url ?? null;
    return group.records.map((record) => record.url).find((url) => trackedUrls.has(url)) ?? group.latest.url;
  }, [group, trackedUrls]);

  useEffect(() => {
    let active = true;
    void listTrackedSites().then((result) => {
      if (active && result.ok) setTrackedUrls(new Set(result.data.map((site) => site.url)));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (requestedTrackUrl.current === trackUrl) return;
    requestedTrackUrl.current = trackUrl;
    // A different trackUrl means any loaded series belongs to a different
    // site — clear it immediately rather than showing stale data until the
    // (possibly skipped, if untracked) fetch below resolves.
    setDailySeries(null);
    if (!trackUrl || !trackedUrls?.has(trackUrl)) return;
    void fetchGrowthSeries(trackUrl).then((result) => {
      if (result.ok) setDailySeries(result.data.series);
    });
  }, [trackUrl, trackedUrls]);

  useEffect(() => {
    let active = true;
    void (latestRecord ? loadReport(latestRecord.id) : Promise.resolve(null)).then((report) => {
      if (!active) return;
      setLatestReport(report);
      // A new latest record means any previously-loaded crawl pages belong
      // to a DIFFERENT report — never let them leak into this one's plan.
      setTechnicalPages(null);
    });
    return () => {
      active = false;
    };
  }, [latestRecord]);

  useEffect(() => {
    let active = true;
    void (previousRecord ? loadReport(previousRecord.id) : Promise.resolve(null)).then((report) => {
      if (active) setPreviousReport(report);
    });
    return () => {
      active = false;
    };
  }, [previousRecord]);

  const currentPlan = useMemo(() => (latestReport ? planFor(latestReport, technicalPages) : null), [latestReport, technicalPages]);
  // The diff compares like-for-like: neither side counts technical-crawl
  // issues, so mounting the crawl panel never shows as a spike of "new" items.
  const planDiff: ActionPlanDiff | null = useMemo(() => {
    if (!latestReport || !previousReport) return null;
    return diffActionPlans(planFor(previousReport, null), planFor(latestReport, null));
  }, [latestReport, previousReport]);
  const issueTrend = useMemo(() => (group ? domainIssueTrend(group.records) : []), [group]);
  const overall = group ? averageScore(group.latest) : null;

  if (!ready) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <p className="wb-skeleton text-sm text-text-3">Loading site…</p>
      </main>
    );
  }

  if (!group) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <p className="font-mono text-xs uppercase tracking-wider text-text-3">Site hub</p>
        <h1 className="mt-2 text-2xl font-semibold">No audits yet for {host}</h1>
        <p className="mt-3 text-sm text-text-2">
          Run an audit for this domain and it appears here — growth trend, audit history, and its
          current action plan all in one place.
        </p>
        <Link href="/" className="mt-5 inline-block font-mono text-xs uppercase tracking-wider text-accent-ink hover:underline">
          ← Start an audit
        </Link>
      </main>
    );
  }

  // Per-domain checks below scope to the latest site-kind report's root URL
  // when one exists, otherwise the domain's most recent audited URL.
  const skillScopeUrl = (latestReport?.kind === "site" && latestReport.state.rootUrl) || group.latest.url;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/dashboard" className="font-mono text-xs uppercase tracking-wider text-accent-ink hover:underline">← Growth overview</Link>
          <h1 className="mt-2 truncate text-3xl font-semibold tracking-tight">{group.domain}</h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-text-3">
            {group.auditCount} audit{group.auditCount === 1 ? "" : "s"} · last {new Date(group.lastAuditedAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/audit/agent?url=${encodeURIComponent(group.latest.url)}`)}
          >
            Run agent audit
          </Button>
          <DeltaChip delta={group.delta} />
          {overall !== null && (
            <strong className="font-mono text-3xl tabular-nums" style={{ color: scoreBand(overall).colorVar }}>
              {overall}
            </strong>
          )}
        </div>
      </div>

      <Card bodyClassName="flex flex-col gap-3 p-4">
        {(() => {
          const daily = dailySeries ? seriesScores(dailySeries) : [];
          const sparkSeries = daily.length >= 2 ? daily : group.series;
          if (sparkSeries.length < 2) return <p className="text-sm text-text-2">Run another audit to start a trend line.</p>;
          return <TrendSparkline series={sparkSeries} noun={daily.length >= 2 ? "days" : "audits"} />;
        })()}
        {group.latestScores && <LensScoreGrid scores={group.latestScores} />}
        {trackUrl && (
          <TrackToggle
            url={trackUrl}
            tracked={trackedUrls?.has(trackUrl) ?? false}
            onTrackedChange={(tracked) =>
              setTrackedUrls((prev) => {
                const next = new Set(prev ?? []);
                if (tracked) next.add(trackUrl);
                else next.delete(trackUrl);
                return next;
              })
            }
          />
        )}
      </Card>

      {issueTrend.length >= 2 && (
        <Card label="Issues found per audit" labelAs="h2" bodyClassName="p-4">
          <TrendSparkline series={issueTrend} noun="audits" />
          {planDiff && (
            <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-text-2">
              Since the previous audit: {planDiff.resolved} resolved · {planDiff.introduced} new
            </p>
          )}
        </Card>
      )}

      {currentPlan && <ActionPlanPanel plan={currentPlan} />}

      {latestReport?.kind === "site" && latestReport.state.rootUrl && (
        // Keyed by report id: a fresh mount per report, matching the fresh
        // `technicalPages` reset above rather than reusing stale crawl state.
        <TechnicalSeoPanel key={latestReport.id} auditId={latestReport.id} rootUrl={latestReport.state.rootUrl} limit={500} onPages={setTechnicalPages} />
      )}

      {HUB_SKILL_IDS.map((skillId) => (
        <SkillPanel
          key={skillId}
          skillId={skillId}
          scope={{ kind: SKILL_REGISTRY[skillId]?.scopeKind ?? "site", url: skillScopeUrl }}
          // Paid routes require an owned audit as their ownership/ledger
          // anchor; free routes ignore it. Without it, paid Run buttons 400.
          // Fall back to the latest record of ANY kind: the route needs an
          // owned audit_runs row, not a saved report (latestRecord is
          // report-bearing only and can be null for report-less domains).
          auditId={latestRecord?.id ?? group.latest.id}
          labelAs="h2"
        />
      ))}

      {/* Same report-less-domain fallback as the HUB_SKILL_IDS loop above —
          the route needs an owned audit_runs row, not a saved report. */}
      <ComparePanel auditId={latestRecord?.id ?? group.latest.id} labelAs="h2" />

      <Card label="Audit history" labelAs="h2">
        <ul className="divide-y divide-line">
          {group.records.slice(0, 20).map((record) => (
            <li key={record.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span className="font-mono text-[11px] text-text-2">{new Date(record.createdAt).toLocaleString()}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-3">{record.mode} · {record.status}</span>
              {record.reportAvailable ? (
                <Link href={`/report/${encodeURIComponent(record.id)}`} className="font-mono text-[10px] uppercase tracking-wider text-accent-ink hover:underline">
                  Open report
                </Link>
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-wider text-text-3">No saved report</span>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
