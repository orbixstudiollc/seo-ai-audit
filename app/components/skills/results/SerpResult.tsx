import type { SerpSkillResult, SkillTask } from "@/lib/skills/types";

function readResult(task: SkillTask): SerpSkillResult | null {
  if (task.resultVersion !== 1 || !task.result) return null;
  const result = task.result as Partial<SerpSkillResult>;
  if (typeof result.keyword !== "string" || !Array.isArray(result.entries)) return null;
  return result as SerpSkillResult;
}

/** DATA-CONTRACT §8.1 SerpSkillResult renderer. */
export function SerpResult({ task }: { task: SkillTask }) {
  const result = readResult(task);
  if (!result) return <p className="text-xs text-text-3">Unrecognized result version — rerun this check.</p>;

  if (result.entries.length === 0) {
    return <p className="text-xs text-text-3">No ranking data for “{result.keyword}” yet.</p>;
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-[var(--radius-lg,5px)] border border-line">
      <ul className="divide-y divide-line">
        {result.entries.map((entry) => (
          <li key={entry.rank} className="flex items-center gap-3 px-3 py-2">
            <span className="shrink-0 font-mono text-xs tabular-nums text-text-3">#{entry.rank}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-text-1">
                {entry.title}
                {entry.isOwn && <span className="ml-1 font-medium text-accent-ink">(you)</span>}
              </p>
              <p className="truncate font-mono text-[10px] text-text-3">{entry.domain}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
