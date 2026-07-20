"use client";

import { useMemo, useState } from "react";
import type { DetSignalId, DetSignalResult, Lens, ScoreBreakdown } from "@aeo/scoring";
import type {
  AuditErrorKind,
  AuditFindings,
  AuditRewrites,
  AuditStreamPhase,
  PageMeta,
} from "@/lib/audit/types";
import { isRubResult } from "@/lib/audit/signalMeta";
import type { FindingItem } from "@/lib/audit/derive";
import { buildActionPlan } from "@/lib/skills/actionPlan";
import { LENSES, LENS_WEIGHTS } from "@aeo/scoring";
import { Button } from "@/app/components/ui/Button";
import { Card } from "@/app/components/ui/Card";
import { ScoreRail } from "@/app/components/workbench/ScoreRail";
import { SignalBreakdown } from "@/app/components/workbench/SignalBreakdown";
import { ActionPlanPanel } from "./ActionPlanPanel";
import { ReportHeader, ReportHeaderSkeleton } from "./ReportHeader";
import { FindingsPanel } from "./FindingsPanel";
import { RewritesPanel } from "./RewritesPanel";
import { ReportActions } from "./ReportActions";

type StreamError = { kind: AuditErrorKind; message: string; retryAfter?: number };

type Props = {
  phase: AuditStreamPhase;
  page: PageMeta | null;
  signals: Record<DetSignalId, DetSignalResult> | null;
  scores: ScoreBreakdown | null;
  findings: AuditFindings | null;
  rewrites: AuditRewrites | null;
  error: StreamError | null;
  onRetry: () => void;
  retryLabel?: string;
};

const ERROR_LABEL: Record<AuditErrorKind, string> = {
  invalid_url: "That URL doesn't look valid.",
  fetch_failed: "Couldn't fetch that page.",
  unsupported_content: "That page's content couldn't be audited.",
  rate_limit: "Too many audits — try again shortly.",
  server: "Something went wrong running the audit.",
};

/** The lens a signal most strongly drives — used to jump from a finding to its breakdown. */
export function primaryLensFor(signalId: FindingItem["signalId"]): Lens {
  let best: Lens = LENSES[0];
  if (!signalId) return best;
  let bestWeight = -1;
  for (const lens of LENSES) {
    const weight = LENS_WEIGHTS[lens][signalId] ?? 0;
    if (weight > bestWeight) {
      bestWeight = weight;
      best = lens;
    }
  }
  return best;
}

export function eeatFrom(breakdown: ScoreBreakdown | null) {
  if (!breakdown) return null;
  const result = breakdown.signals.S17;
  return isRubResult(result) ? result : null;
}

/**
 * Presentational report: the full progressive experience (skeleton -> partial
 * -> full -> error-with-partial), driven entirely by props so it can be
 * rendered by the live `AuditRunner` (hook-backed) or directly against
 * `mockReport` on `/dev/mock-report`, bypassing the hook.
 */
export function AuditReportView({ phase, page, signals, scores, findings, rewrites, error, onRetry, retryLabel = "Run again" }: Props) {
  const [openLens, setOpenLens] = useState<Lens | null>(null);

  const isTerminalError = phase === "error";
  const eeatResult = eeatFrom(scores);

  // A prioritized, severity-ranked fix list synthesized from the same findings
  // and scores already on screen (DATA-CONTRACT §10). Pure + deterministic
  // apart from the generated-at stamp, which is not a render dependency.
  const actionPlan = useMemo(
    () =>
      scores && findings
        ? buildActionPlan({ generatedAt: new Date().toISOString(), url: page?.finalUrl, findings, scores })
        : null,
    [page?.finalUrl, scores, findings],
  );

  function handleActivateFinding(item: FindingItem) {
    if (item.signalId) setOpenLens(primaryLensFor(item.signalId));
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      {page ? <ReportHeader page={page} /> : <ReportHeaderSkeleton />}

      {isTerminalError && error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg,5px)] border px-3.5 py-3"
          style={{ borderColor: "var(--score-weak)", backgroundColor: "var(--score-weak-tint)" }}
        >
          <p className="text-[13px] leading-snug" style={{ color: "var(--score-weak)" }}>
            <span className="font-medium">{ERROR_LABEL[error.kind]}</span> {error.message}
          </p>
          <Button size="sm" variant="outline" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      )}

      <ScoreRail
        breakdown={scores}
        eeatResult={eeatResult}
        openLens={openLens}
        onOpenLens={(lens) => setOpenLens((cur) => (cur === lens ? null : lens))}
        phase={phase}
        hasSignals={signals !== null}
        hasScores={scores !== null}
        hasRewrites={rewrites !== null}
      />

      {openLens && scores && (
        <Card
          label="Score breakdown"
          bodyClassName="min-h-0"
          aside={
            <button
              type="button"
              onClick={() => setOpenLens(null)}
              className="font-mono text-[10px] uppercase tracking-wider text-accent-ink hover:underline"
            >
              ← Back
            </button>
          }
        >
          <SignalBreakdown lens={openLens} breakdown={scores} />
        </Card>
      )}

      {actionPlan && <ActionPlanPanel plan={actionPlan} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FindingsPanel breakdown={scores} findings={findings} onActivateFinding={handleActivateFinding} />
        <RewritesPanel rewrites={rewrites} />
      </div>

      {page && scores && findings && (
        <ReportActions report={{ page, scores, findings, rewrites }} />
      )}
    </div>
  );
}
