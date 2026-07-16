"use client";

import Link from "next/link";
import type { Lens, RubSignalResult, ScoreBreakdown } from "@aeo/scoring";
import type { AuditErrorKind, AuditStreamPhase } from "@/lib/audit/types";
import { ScoreTile } from "@/app/components/ui/ScoreTile";
import { Button } from "@/app/components/ui/Button";
import { LENS_META, LENS_ORDER } from "@/lib/audit/signalMeta";
import { EeatStrip } from "./EeatStrip";

type Props = {
  breakdown: ScoreBreakdown | null;
  isEstimated: boolean;
  eeatResult: RubSignalResult | null;
  openLens: Lens | null;
  onOpenLens: (lens: Lens) => void;
  phase: AuditStreamPhase;
  hasScores: boolean;
  hasRewrites: boolean;
  hasAudit: boolean;
  modelId: string | null;
  error: string | null;
  errorKind: AuditErrorKind | null;
  /** Pre-run cost estimate label shown next to the Run/Re-score control. */
  costEstimate: string | null;
  onRun: () => void;
  onCancel: () => void;
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
  isEstimated,
  eeatResult,
  openLens,
  onOpenLens,
  phase,
  hasScores,
  hasRewrites,
  hasAudit,
  modelId,
  error,
  errorKind,
  costEstimate,
  onRun,
  onCancel,
}: Props) {
  const isStreaming = phase === "connecting" || phase === "streaming";
  const loading = isStreaming && !breakdown;

  const scoreLabel = !hasAudit
    ? "Not yet audited"
    : isEstimated
      ? "Estimated — re-score to confirm"
      : "True rubric score";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {LENS_ORDER.map((lens) => (
          <ScoreTile
            key={lens}
            code={LENS_META[lens].code}
            name={LENS_META[lens].name}
            value={breakdown ? breakdown.lenses[lens].score : null}
            isEstimated={isEstimated}
            capped={breakdown?.lenses[lens].capped}
            loading={loading}
            active={openLens === lens}
            onOpen={() => onOpenLens(lens)}
          />
        ))}
      </div>

      <EeatStrip result={eeatResult} />

      <div className="rounded-[var(--radius-lg,5px)] border border-line bg-surface-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: isEstimated ? "var(--accent-ink)" : hasAudit ? "var(--score-strong)" : "var(--text-3)" }}
              aria-hidden="true"
            />
            <span className="text-[12px] font-medium text-text-1">{scoreLabel}</span>
          </span>
          {isStreaming ? (
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={onRun}>
              {hasAudit ? "Re-score" : "Run audit"}
            </Button>
          )}
        </div>

        {isStreaming && (
          <div className="mt-2.5 flex items-center gap-3">
            <PhaseChip label="Structure" state="done" />
            <PhaseChip label="Scores" state={hasScores ? "done" : "active"} />
            <PhaseChip label="Rewrites" state={hasRewrites ? "done" : hasScores ? "active" : "pending"} />
          </div>
        )}

        {modelId && !isStreaming && !error && (
          <p className="mt-1.5 font-mono text-[10px] text-text-3">
            model <span className="text-text-2">{modelId}</span>
          </p>
        )}

        {costEstimate && !isStreaming && (
          <p className="mt-1.5 font-mono text-[10px] text-text-3">
            {hasAudit ? "re-score" : "run"} <span className="text-text-2">{costEstimate}</span>
          </p>
        )}

        {error && (
          <p
            className="mt-2 rounded-sm px-2 py-1 text-[12px] leading-snug"
            style={{ color: "var(--score-weak)", backgroundColor: "var(--score-weak-tint)" }}
          >
            {error}
            {errorKind === "no_key" && (
              <>
                {" "}
                <Link href="/app/settings" className="font-medium underline underline-offset-2">
                  Open Settings →
                </Link>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
