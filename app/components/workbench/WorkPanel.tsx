"use client";

import type { Lens, ScoreBreakdown } from "@aeo/scoring";
import type { FindingItem } from "@/lib/audit/derive";
import type { AuditRewrites, RewriteHunk } from "@/lib/audit/types";
import { Card } from "@/app/components/ui/Card";
import type { HunkStatus } from "@/app/components/ui/DiffHunk";
import { FindingsDrawer } from "./FindingsDrawer";
import { RewritePanel } from "./RewritePanel";
import { RoadmapPanel } from "./RoadmapPanel";
import { SchemaBlock } from "./SchemaBlock";
import { SignalBreakdown } from "./SignalBreakdown";

export type WorkTab = "findings" | "rewrites" | "roadmap" | "schema";

const TABS: { id: WorkTab; label: string }[] = [
  { id: "findings", label: "Findings" },
  { id: "rewrites", label: "Rewrites" },
  { id: "roadmap", label: "Roadmap" },
  { id: "schema", label: "Schema" },
];

type Props = {
  tab: WorkTab;
  onTab: (tab: WorkTab) => void;
  openLens: Lens | null;
  onCloseLens: () => void;
  breakdown: ScoreBreakdown | null;
  findingItems: FindingItem[];
  findingCount: number;
  rewriteCount: number;
  onActivateFinding: (item: FindingItem) => void;
  rewrites: AuditRewrites | null;
  hunkStatuses: Record<string, HunkStatus>;
  onAccept: (hunk: RewriteHunk) => void;
  onReject: (hunk: RewriteHunk) => void;
  onReset: (hunk: RewriteHunk) => void;
  schemaJson: string | null;
};

export function WorkPanel(props: Props) {
  const { tab, onTab, openLens, onCloseLens, breakdown, findingCount, rewriteCount } = props;

  if (openLens && breakdown) {
    return (
      <Card
        label="Score breakdown"
        className="min-h-0 flex-1"
        bodyClassName="min-h-0 overflow-hidden"
        aside={
          <button
            type="button"
            onClick={onCloseLens}
            className="font-mono text-[10px] uppercase tracking-wider text-accent-ink hover:underline"
          >
            ← Back
          </button>
        }
      >
        <SignalBreakdown lens={openLens} breakdown={breakdown} />
      </Card>
    );
  }

  const counts: Partial<Record<WorkTab, number>> = { findings: findingCount, rewrites: rewriteCount };

  return (
    <Card className="min-h-0 flex-1" bodyClassName="min-h-0 overflow-auto">
      <div
        role="tablist"
        aria-label="Workbench panels"
        className="sticky top-0 z-10 flex border-b border-line bg-surface-1"
      >
        {TABS.map((t) => {
          const isActive = tab === t.id;
          const count = counts[t.id];
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onTab(t.id)}
              className={`relative flex items-center gap-1.5 px-3.5 py-2 font-mono text-[11px] font-medium uppercase tracking-wider transition-colors duration-[var(--dur-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ink ${
                isActive ? "text-text-1" : "text-text-3 hover:text-text-2"
              }`}
            >
              {t.label}
              {count !== undefined && count > 0 && (
                <span className="rounded-full bg-surface-3 px-1.5 text-[10px] tabular-nums text-text-2">{count}</span>
              )}
              {isActive && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-text-1" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {tab === "findings" && (
          <FindingsDrawer items={props.findingItems} onActivate={props.onActivateFinding} />
        )}
        {tab === "rewrites" && (
          <RewritePanel
            rewrites={props.rewrites}
            statuses={props.hunkStatuses}
            onAccept={props.onAccept}
            onReject={props.onReject}
            onReset={props.onReset}
          />
        )}
        {tab === "roadmap" && <RoadmapPanel breakdown={breakdown} />}
        {tab === "schema" && <SchemaBlock json={props.schemaJson} />}
      </div>
    </Card>
  );
}
