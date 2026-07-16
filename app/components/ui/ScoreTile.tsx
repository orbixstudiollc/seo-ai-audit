"use client";

import { useAnimatedNumber } from "@/app/hooks/useAnimatedNumber";
import { scoreBand } from "@/lib/audit/scoreScale";

type Props = {
  code: string;
  name: string;
  value: number | null;
  isEstimated?: boolean;
  capped?: boolean;
  loading?: boolean;
  active?: boolean;
  onOpen?: () => void;
};

/**
 * The headline 0-100 score tile. Mono numeral, semantic band color that is
 * ALWAYS paired with a glyph + text label (colorblind-safe), a compositor-only
 * bar (transform: scaleX) that re-animates on re-score, and a click target that
 * opens the per-signal "why you scored N" breakdown.
 */
export function ScoreTile({ code, name, value, isEstimated, capped, loading, active, onOpen }: Props) {
  const band = scoreBand(value);
  const display = useAnimatedNumber(value ?? 0);
  const isEmpty = value === null;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${name} score ${isEmpty ? "not yet scored" : `${value} out of 100, ${band.label}`}. Open breakdown.`}
      aria-pressed={active}
      className={`group relative flex flex-col overflow-hidden rounded-[var(--radius-lg,5px)] border bg-surface-1 p-3 text-left transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink ${
        active ? "border-text-1 shadow-[0_1px_0_var(--text-1)]" : "border-line hover:border-line-strong"
      }`}
    >
      <span className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-3">{code}</span>
        <span
          className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wide"
          style={{ color: band.colorVar }}
        >
          <span aria-hidden="true">{band.glyph}</span>
          {band.label}
        </span>
      </span>

      <span className="mt-1 flex items-baseline gap-1.5">
        <span
          className="font-mono text-[2.4rem] font-semibold leading-none tabular-nums"
          style={{ color: isEmpty ? "var(--text-3)" : band.colorVar }}
        >
          {isEmpty ? (loading ? <span className="wb-skeleton">··</span> : "—") : display}
        </span>
        {!isEmpty && <span className="font-mono text-[11px] text-text-3">/100</span>}
      </span>

      <span className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
        <span
          data-animate
          className="block h-full origin-left rounded-full transition-transform duration-[var(--dur-slow)] ease-[var(--ease-out)]"
          style={{ backgroundColor: band.colorVar, transform: `scaleX(${(value ?? 0) / 100})` }}
        />
      </span>

      <span className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-text-2">{name}</span>
        {isEstimated && (
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-accent-ink">est.</span>
        )}
        {capped && !isEstimated && (
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider" style={{ color: band.colorVar }}>
            capped
          </span>
        )}
      </span>
    </button>
  );
}
