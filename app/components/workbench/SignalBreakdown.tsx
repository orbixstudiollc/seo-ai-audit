"use client";

import { LENS_WEIGHTS, type Lens, type ScoreBreakdown, type SignalId } from "@aeo/scoring";
import { scoreBand } from "@/lib/audit/scoreScale";
import { isDetResult, isRubResult, LENS_META, SIGNAL_META } from "@/lib/audit/signalMeta";

type Props = {
  lens: Lens;
  breakdown: ScoreBreakdown;
};

function formatDetailKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function formatDetailValue(value: number | string | boolean): string {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return value;
}

/**
 * "Why you scored N" for one lens: the contributing signals ranked by weight,
 * each showing its score, its weight in this lens, the points it contributes,
 * and its evidence — a verbatim quote for RUB signals, the raw measurements
 * for DET. This is where the score earns the user's trust.
 */
export function SignalBreakdown({ lens, breakdown }: Props) {
  const meta = LENS_META[lens];
  const lensScore = breakdown.lenses[lens];
  const band = scoreBand(lensScore.score);
  const weights = LENS_WEIGHTS[lens];
  const contributors = (Object.keys(weights) as SignalId[])
    .map((id) => ({ id, weight: weights[id] ?? 0 }))
    .sort((a, b) => b.weight - a.weight);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-3">
            {meta.code} · {meta.name}
          </p>
          <p className="mt-0.5 max-w-xs text-[12px] leading-snug text-text-2">{meta.blurb}</p>
        </div>
        <div className="text-right">
          <span className="font-mono text-3xl font-semibold tabular-nums" style={{ color: band.colorVar }}>
            {lensScore.score}
          </span>
          <p className="font-mono text-[10px] uppercase tracking-wide" style={{ color: band.colorVar }}>
            {band.glyph} {band.label}
          </p>
        </div>
      </div>

      {lensScore.capped && lensScore.capReason && (
        <p
          className="border-b border-line px-4 py-2 text-[12px] leading-snug"
          style={{ color: "var(--score-weak)", backgroundColor: "var(--score-weak-tint)" }}
        >
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wider">Hard cap · </span>
          {lensScore.capReason}
        </p>
      )}

      <ul className="min-h-0 flex-1 divide-y divide-line overflow-auto">
        {contributors.map(({ id, weight }) => {
          const result = breakdown.signals[id];
          const sMeta = SIGNAL_META[id];
          const sBand = scoreBand(result.score);
          const contribution = Math.round((result.score * weight) / 100);
          return (
            <li key={id} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span
                    className="rounded-sm border px-1 font-mono text-[9px] font-semibold uppercase tracking-wider"
                    style={{
                      color: sMeta.cls === "RUB" ? "var(--accent-ink)" : "var(--text-3)",
                      borderColor: sMeta.cls === "RUB" ? "var(--accent-line)" : "var(--line-strong)",
                    }}
                  >
                    {sMeta.cls}
                  </span>
                  <span className="text-[13px] font-medium text-text-1">{sMeta.label}</span>
                </span>
                <span className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-text-3">
                  <span>w{weight}</span>
                  <span aria-hidden="true">×</span>
                  <span className="font-semibold" style={{ color: sBand.colorVar }}>
                    {result.score}
                  </span>
                  <span aria-hidden="true">=</span>
                  <span className="font-semibold text-text-1">+{contribution}</span>
                </span>
              </div>

              <div className="mt-1.5 flex items-center gap-2">
                <span className="block h-1 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                  <span
                    className="block h-full origin-left rounded-full"
                    style={{ backgroundColor: sBand.colorVar, transform: `scaleX(${result.score / 100})` }}
                  />
                </span>
              </div>

              {isRubResult(result) &&
                (result.evidence ? (
                  <p className="mt-1.5 border-l-2 border-line-strong pl-2 text-[12px] italic leading-snug text-text-2">
                    &ldquo;{result.evidence}&rdquo;
                  </p>
                ) : (
                  <p className="mt-1.5 text-[11px] text-text-3">No supporting passage found — scored conservatively.</p>
                ))}

              {isDetResult(result) && (
                <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                  {Object.entries(result.detail)
                    .slice(0, 4)
                    .map(([key, value]) => (
                      <div key={key} className="flex items-baseline gap-1">
                        <dt className="font-mono text-[10px] text-text-3">{formatDetailKey(key)}</dt>
                        <dd className="font-mono text-[10px] font-medium tabular-nums text-text-2">
                          {formatDetailValue(value)}
                        </dd>
                      </div>
                    ))}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
