import type { HreflangSkillResult, SkillTask } from "@/lib/skills/types";
import { StatGrid } from "../StatGrid";

function readResult(task: SkillTask): HreflangSkillResult | null {
  if (task.resultVersion !== 1 || !task.result) return null;
  const result = task.result as Partial<HreflangSkillResult>;
  if (!Array.isArray(result.tags) || !Array.isArray(result.checks)) return null;
  return result as HreflangSkillResult;
}

/** DATA-CONTRACT §8.1 HreflangSkillResult renderer. */
export function HreflangResult({ task }: { task: SkillTask }) {
  const result = readResult(task);
  if (!result) return <p className="text-xs text-text-3">Unrecognized result version — rerun this check.</p>;

  const passed = result.checks.filter((check) => check.pass).length;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <StatGrid
        stats={[
          ["Tags", result.tags.length],
          ["Passed", passed],
          ["Failed", result.checks.length - passed],
        ]}
      />

      <ul className="divide-y divide-line rounded-[var(--radius-lg,5px)] border border-line">
        {result.checks.map((check) => (
          <li key={check.code} className="flex flex-col gap-1 px-3 py-2">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className={check.pass ? "text-score-strong" : "text-score-weak"}>
                {check.pass ? "✓" : "✕"}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wide text-text-3">{check.pass ? "Pass" : "Fail"}</span>
              <span className="text-xs text-text-1">{check.code}</span>
            </div>
            <p className="text-xs text-text-2">{check.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
