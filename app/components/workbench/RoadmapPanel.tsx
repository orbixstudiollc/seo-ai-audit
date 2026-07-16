import type { ScoreBreakdown } from "@aeo/scoring";
import { computeRoadmap, type RoadmapBucket, type RoadmapItem } from "@/lib/audit/derive";
import { LENS_META } from "@/lib/audit/signalMeta";
import { scoreBand } from "@/lib/audit/scoreScale";

type Props = {
  breakdown: ScoreBreakdown | null;
};

const BUCKET_META: Record<RoadmapBucket, { label: string; hint: string }> = {
  quick: { label: "Quick wins", hint: "Structural fixes you can make right now" },
  strategic: { label: "Strategic", hint: "Rewrites that need judgment" },
  long: { label: "Long-term", hint: "New research, data, or credentials" },
};

const BUCKET_ORDER: RoadmapBucket[] = ["quick", "strategic", "long"];

function Row({ item }: { item: RoadmapItem }) {
  const band = scoreBand(item.score);
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <span
        className="w-12 shrink-0 text-right font-mono text-sm font-semibold tabular-nums"
        title="Scoring impact = Σ weight × (100 − score)"
      >
        +{item.impact}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-text-1">{item.label}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {item.lenses.map((lens) => (
            <span key={lens} className="font-mono text-[9px] uppercase tracking-wide text-text-3">
              {LENS_META[lens].code}
            </span>
          ))}
        </span>
      </span>
      <span
        className="shrink-0 font-mono text-[11px] font-semibold tabular-nums"
        style={{ color: band.colorVar }}
      >
        {item.score}
      </span>
    </li>
  );
}

/**
 * Priority-ordered fix list, grouped Quick wins / Strategic / Long-term.
 * Priority is arithmetic — the scoring impact of fixing each signal across all
 * four lenses — not editorial opinion.
 */
export function RoadmapPanel({ breakdown }: Props) {
  if (!breakdown) {
    return (
      <p className="px-4 py-6 text-center text-[13px] text-text-3">
        The roadmap ranks every weak signal by its true scoring impact. Run an audit to build it.
      </p>
    );
  }

  const items = computeRoadmap(breakdown);
  const grouped = BUCKET_ORDER.map((bucket) => ({
    bucket,
    items: items.filter((i) => i.bucket === bucket),
  })).filter((g) => g.items.length > 0);

  if (grouped.length === 0) {
    return <p className="px-4 py-6 text-center text-[13px] text-text-3">Every signal is maxed. Nothing to fix.</p>;
  }

  return (
    <div className="flex flex-col">
      {grouped.map(({ bucket, items: bucketItems }) => (
        <div key={bucket}>
          <div className="sticky top-0 z-10 flex items-baseline justify-between gap-2 border-b border-line bg-surface-2 px-4 py-1.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-text-2">
              {BUCKET_META[bucket].label}
            </span>
            <span className="text-[10px] text-text-3">{BUCKET_META[bucket].hint}</span>
          </div>
          <ul className="divide-y divide-line">
            {bucketItems.map((item) => (
              <Row key={item.signalId} item={item} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
