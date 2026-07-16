"use client";

import type { Lens, RubSignalResult, ScoreBreakdown } from "@aeo/scoring";
import type { AuditStreamPhase } from "@/lib/audit/types";
import { ScoreTile } from "@/app/components/ui/ScoreTile";
import { LENS_META, LENS_ORDER } from "@/lib/audit/signalMeta";
import { EeatStrip } from "./EeatStrip";

type Props = {
  breakdown: ScoreBreakdown | null;
  eeatResult: RubSignalResult | null;
  openLens: Lens | null;
  onOpenLens: (lens: Lens) => void;
  phase: AuditStreamPhase;
  hasSignals: boolean;
  hasScores: boolean;
  hasRewrites: boolean;
};

type ChipState = "done" | "active" | "pending";

function PhaseChip({ label, state }: { label: string; state: ChipState }) {
  const glyph = state === "done" ? "✓" : state === "active" ? "•" : "·";
  const color = state === "done" ? "var(--score-strong)" : state === "active" ? "var(--accent-ink)" : "var(--text-3)";
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide" style={{ color }}>
      <span aria-hidden="true" className={state === "active" ? "wb-skeleton" : ""}>
        {glyph}
      </span>
      {label}
    </span>
  );
}

export function ScoreRail({
  breakdown,
  eeatResult,
  openLens,
  onOpenLens,
  phase,
  hasSignals,
  hasScores,
  hasRewrites,
}: Props) {
  const isStreaming = phase === "connecting" || phase === "streaming";
  const loading = isStreaming && !breakdown;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {LENS_ORDER.map((lens) => (
          <ScoreTile
            key={lens}
            code={LENS_META[lens].code}
            name={LENS_META[lens].name}
            value={breakdown ? breakdown.lenses[lens].score : null}
            capped={breakdown?.lenses[lens].capped}
            loading={loading}
            active={openLens === lens}
            onOpen={() => onOpenLens(lens)}
          />
        ))}
      </div>

      <EeatStrip result={eeatResult} />

      {isStreaming && (
        <div className="rounded-[var(--radius-lg,5px)] border border-line bg-surface-1 p-3">
          <div className="flex items-center gap-3">
            <PhaseChip label="Structure" state={hasSignals ? "done" : "active"} />
            <PhaseChip label="Scores" state={hasScores ? "done" : hasSignals ? "active" : "pending"} />
            <PhaseChip label="Rewrites" state={hasRewrites ? "done" : hasScores ? "active" : "pending"} />
          </div>
        </div>
      )}

      {breakdown && !isStreaming && (
        <p className="font-mono text-[10px] text-text-3">
          rubric <span className="text-text-2">{breakdown.rubricVersion}</span> · signals{" "}
          <span className="text-text-2">{breakdown.signalsVersion}</span> · model{" "}
          <span className="text-text-2">{breakdown.modelId}</span>
        </p>
      )}
    </div>
  );
}
