import type { CompareSkillResult, SkillTask } from "@/lib/skills/types";
import { LENS_META, LENS_ORDER } from "@/lib/audit/signalMeta";
import { scoreBand } from "@/lib/audit/scoreScale";

function readResult(task: SkillTask): CompareSkillResult | null {
  if (task.resultVersion !== 1 || !task.result) return null;
  const result = task.result as Partial<CompareSkillResult>;
  if (typeof result.keyword !== "string" || !result.mine || !Array.isArray(result.competitors)) return null;
  return result as CompareSkillResult;
}

function competitorLabel(url: string, rank: number): string {
  try {
    return `#${rank} ${new URL(url).hostname}`;
  } catch {
    return `#${rank} ${url}`;
  }
}

function ScoreDot({ value }: { value: number | null }) {
  const info = scoreBand(value);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" style={{ color: info.colorVar }}>
        {info.glyph}
      </span>
      <span className="font-mono text-xs tabular-nums text-text-1">{value === null ? "—" : value}</span>
    </span>
  );
}

/** DATA-CONTRACT §8.1 CompareSkillResult renderer. */
export function CompareResult({ task }: { task: SkillTask }) {
  const result = readResult(task);
  if (!result) return <p className="text-xs text-text-3">Unrecognized result version — rerun this check.</p>;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="min-w-0 overflow-x-auto rounded-[var(--radius-lg,5px)] border border-line">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-line bg-surface-2">
              <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-text-3">Lens</th>
              <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-text-3">You</th>
              {result.competitors.map((competitor) => (
                <th key={competitor.url} className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-text-3">
                  {competitorLabel(competitor.url, competitor.rank)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {LENS_ORDER.map((lens) => (
              <tr key={lens}>
                <td className="px-3 py-2 text-xs text-text-2">{LENS_META[lens].name}</td>
                <td className="px-3 py-2">
                  <ScoreDot value={result.mine.scores?.[lens] ?? null} />
                </td>
                {result.competitors.map((competitor) => (
                  <td key={competitor.url} className="px-3 py-2">
                    <ScoreDot value={competitor.scores?.[lens] ?? null} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result.competitors
        .filter((competitor) => competitor.topFindings.length > 0)
        .map((competitor) => (
          <div key={competitor.url} className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-wider text-text-3">
              {competitorLabel(competitor.url, competitor.rank)}
            </p>
            <ul className="mt-1 list-disc pl-4 text-xs text-text-2">
              {competitor.topFindings.map((finding, index) => (
                <li key={index}>{finding}</li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
