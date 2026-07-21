import type { LabsSkillResult, SkillTask } from "@/lib/skills/types";

const DISPLAY_CAP = 20;

function readResult(task: SkillTask): LabsSkillResult | null {
  if (task.resultVersion !== 1 || !task.result) return null;
  const result = task.result as Partial<LabsSkillResult>;
  if (!Array.isArray(result.rows)) return null;
  return result as LabsSkillResult;
}

/** DATA-CONTRACT §8.1 LabsSkillResult renderer. */
export function LabsResult({ task }: { task: SkillTask }) {
  const result = readResult(task);
  if (!result) return <p className="text-xs text-text-3">Unrecognized result version — rerun this check.</p>;
  if (result.rows.length === 0) return <p className="text-xs text-text-3">No ranked-keyword data yet.</p>;

  const visible = result.rows.slice(0, DISPLAY_CAP);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="min-w-0 overflow-x-auto rounded-[var(--radius-lg,5px)] border border-line">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-line bg-surface-2">
              <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-text-3">Keyword</th>
              <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-text-3">Position</th>
              <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-text-3">Volume</th>
              <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-text-3">Landing page</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visible.map((row) => (
              <tr key={row.keyword}>
                <td className="min-w-0 px-3 py-2 text-xs text-text-1">{row.keyword}</td>
                <td className="px-3 py-2 font-mono text-xs tabular-nums text-text-2">{row.position ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs tabular-nums text-text-2">{row.volume ?? "—"}</td>
                <td className="min-w-0 max-w-40 truncate px-3 py-2 font-mono text-[11px] text-text-3">{row.url ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.rows.length > DISPLAY_CAP && (
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-3">
          Showing {DISPLAY_CAP} of {result.rows.length}
        </p>
      )}
    </div>
  );
}
