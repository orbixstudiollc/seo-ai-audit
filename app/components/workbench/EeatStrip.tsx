import type { RubSignalResult } from "@aeo/scoring";
import { scoreBand } from "@/lib/audit/scoreScale";
import { EEAT_PILLARS } from "@/lib/audit/signalMeta";

type Props = {
  result: RubSignalResult | null;
};

/**
 * E-E-A-T strip: the S17 rubric score surfaced on its own, framed by the four
 * pillars it measures, with the verbatim evidence quote that justified it.
 */
export function EeatStrip({ result }: Props) {
  const value = result?.score ?? null;
  const band = scoreBand(value);

  return (
    <div className="rounded-[var(--radius-lg,5px)] border border-line bg-surface-1 px-3.5 py-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-text-3">
          E-E-A-T
        </span>
        <span className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: band.colorVar }}
          >
            <span aria-hidden="true">{band.glyph}</span>
            {band.label}
          </span>
          <span className="font-mono text-lg font-semibold tabular-nums" style={{ color: band.colorVar }}>
            {value ?? "—"}
          </span>
        </span>
      </div>

      <ul className="mt-2 flex flex-wrap gap-1.5">
        {EEAT_PILLARS.map((pillar) => (
          <li
            key={pillar}
            className="rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-text-2"
          >
            {pillar}
          </li>
        ))}
      </ul>

      {result?.evidence ? (
        <p className="mt-2 border-l-2 border-line-strong pl-2 text-[12px] italic leading-snug text-text-2">
          &ldquo;{result.evidence}&rdquo;
        </p>
      ) : (
        <p className="mt-2 text-[12px] leading-snug text-text-3">
          {value === null ? "Run an audit to score trust markers." : "No experience or trust markers found in the text."}
        </p>
      )}
    </div>
  );
}
