import type { Lens } from "@aeo/scoring";
import { LENS_META, LENS_ORDER } from "@/lib/audit/signalMeta";
import { scoreBand } from "@/lib/audit/scoreScale";

/** The 4-lens score strip shared by SiteGrowthCard and the site hub. */
export function LensScoreGrid({ scores }: { scores: Record<Lens, number> }) {
  return (
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
              style={{ backgroundColor: scoreBand(scores[lens]).colorVar }}
            />
            {scores[lens]}
          </strong>
        </div>
      ))}
    </div>
  );
}
