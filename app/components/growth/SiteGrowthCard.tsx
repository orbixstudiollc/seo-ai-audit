import Link from "next/link";
import { LENS_META, LENS_ORDER } from "@/lib/audit/signalMeta";
import { scoreBand } from "@/lib/audit/scoreScale";
import { averageScore } from "@/lib/history";
import type { DomainGroup } from "@/lib/growth/aggregate";
import { TrendSparkline } from "./TrendSparkline";

/** Delta chip: direction glyph + signed number, score-scale colors with text. */
function DeltaChip({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return null;
  const rising = delta > 0;
  // Band color rides on the decorative glyph only; the number stays primary
  // ink so the 10px text keeps WCAG AA contrast on the tinted background.
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-text-1"
      style={{ backgroundColor: rising ? "var(--score-strong-tint)" : "var(--score-weak-tint)" }}
    >
      <span aria-hidden="true" style={{ color: rising ? "var(--score-strong)" : "var(--score-weak)" }}>
        {rising ? "▲" : "▼"}
      </span>
      {rising ? "+" : ""}
      {delta}
      <span className="sr-only">points since the previous audit</span>
    </span>
  );
}

export function SiteGrowthCard({ group }: { group: DomainGroup }) {
  const overall = averageScore(group.latest);
  const rerun =
    group.latest.mode === "site"
      ? `/audit/site?url=${encodeURIComponent(group.latest.url)}`
      : `/audit?url=${encodeURIComponent(group.latest.url)}`;

  return (
    <li className="flex flex-col overflow-hidden rounded-[var(--radius-lg,5px)] border border-line-strong bg-surface-1 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-tight">{group.domain}</h3>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-text-3">
            {group.auditCount} audit{group.auditCount === 1 ? "" : "s"} · last{" "}
            {new Date(group.lastAuditedAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DeltaChip delta={group.delta} />
          {overall !== null && (
            <strong
              className="font-mono text-2xl tabular-nums"
              style={{ color: scoreBand(overall).colorVar }}
            >
              {overall}
            </strong>
          )}
        </div>
      </div>

      {group.series.length >= 2 && (
        <div className="px-4 pb-1">
          <TrendSparkline series={group.series} />
        </div>
      )}

      {group.latestScores && (
        <div className="grid grid-cols-4 gap-px border-t border-line bg-line">
          {LENS_ORDER.map((lens) => (
            <div key={lens} className="flex items-center justify-between bg-surface-2 px-2.5 py-1.5">
              <span className="font-mono text-[9px] uppercase tracking-wider text-text-3">
                {LENS_META[lens].code}
              </span>
              <strong className="inline-flex items-center gap-1 font-mono text-sm tabular-nums text-text-1">
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: scoreBand(group.latestScores![lens]).colorVar }}
                />
                {group.latestScores![lens]}
              </strong>
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-3 border-t border-line px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider">
        {group.latest.reportAvailable && (
          <Link
            href={`/report/${encodeURIComponent(group.latest.id)}`}
            className="font-semibold text-accent-ink hover:underline"
          >
            Latest report
          </Link>
        )}
        <Link href={rerun} className="text-accent-ink hover:underline">
          Run again
        </Link>
        <Link href="/dashboard?tab=history" className="text-text-2 hover:underline">
          History
        </Link>
      </div>
    </li>
  );
}
