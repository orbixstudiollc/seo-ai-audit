import { averageScore, type AuditHistoryRecord } from "@/lib/history";
import type { Lens } from "@aeo/scoring";

/**
 * G1 growth aggregation: pure functions that turn the flat audit-history list
 * into per-domain progress groups. All time-series math for the Growth tab
 * lives here (unit-tested, no React, no fetch) — the components only render.
 */

export interface DomainGroup {
  domain: string;
  /** Newest first, same ordering contract as the history list. */
  records: AuditHistoryRecord[];
  auditCount: number;
  lastAuditedAt: string;
  latest: AuditHistoryRecord;
  latestScores: Record<Lens, number> | null;
  /** Chronological (oldest → newest) overall scores from scored records. */
  series: number[];
  /** Latest overall minus previous overall; null with fewer than 2 scored audits. */
  delta: number | null;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

/** Group history by domain, newest activity first within and across groups. */
export function groupByDomain(records: readonly AuditHistoryRecord[]): DomainGroup[] {
  const byDomain = new Map<string, AuditHistoryRecord[]>();
  for (const record of records) {
    const domain = domainOf(record.url);
    const bucket = byDomain.get(domain);
    if (bucket) bucket.push(record);
    else byDomain.set(domain, [record]);
  }

  const groups: DomainGroup[] = [];
  for (const [domain, bucket] of byDomain) {
    const sorted = [...bucket].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const scored = sorted.filter((record) => averageScore(record) !== null);
    const series = [...scored]
      .reverse()
      .map((record) => averageScore(record))
      .filter((score): score is number => score !== null);
    const latest = sorted[0];
    groups.push({
      domain,
      records: sorted,
      auditCount: sorted.length,
      lastAuditedAt: latest.createdAt,
      latest,
      latestScores: latest.scores ?? null,
      series,
      delta: series.length >= 2 ? series[series.length - 1] - series[series.length - 2] : null,
    });
  }

  return groups.sort(
    (a, b) => new Date(b.lastAuditedAt).getTime() - new Date(a.lastAuditedAt).getTime(),
  );
}

/**
 * Domains that need a look: score dropped since the previous audit, or the
 * most recent audit failed outright. Worst drop first, failures last-audited
 * first among themselves.
 */
export function needsAttention(groups: readonly DomainGroup[]): DomainGroup[] {
  return groups
    .filter((group) => (group.delta !== null && group.delta < 0) || group.latest.status === "failed")
    .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));
}

export interface GrowthSummary {
  domainCount: number;
  auditCount: number;
  /** Mean of each domain's latest overall score; null when nothing is scored. */
  averageLatestScore: number | null;
  lastActivityAt: string | null;
}

export function summarize(groups: readonly DomainGroup[]): GrowthSummary {
  const latestScores = groups
    .map((group) => averageScore(group.latest))
    .filter((score): score is number => score !== null);
  return {
    domainCount: groups.length,
    auditCount: groups.reduce((sum, group) => sum + group.auditCount, 0),
    averageLatestScore: latestScores.length
      ? Math.round(latestScores.reduce((sum, score) => sum + score, 0) / latestScores.length)
      : null,
    lastActivityAt: groups[0]?.lastAuditedAt ?? null,
  };
}
