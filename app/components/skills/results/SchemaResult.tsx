import type { SchemaSkillResult, SkillTask } from "@/lib/skills/types";
import { StatGrid } from "../StatGrid";

function readResult(task: SkillTask): SchemaSkillResult | null {
  if (task.resultVersion !== 1 || !task.result) return null;
  const result = task.result as Partial<SchemaSkillResult>;
  if (!Array.isArray(result.detected) || !Array.isArray(result.missingRecommended) || !Array.isArray(result.generated)) {
    return null;
  }
  return result as SchemaSkillResult;
}

/** DATA-CONTRACT §8.1 SchemaSkillResult renderer. */
export function SchemaResult({ task }: { task: SkillTask }) {
  const result = readResult(task);
  if (!result) return <p className="text-xs text-text-3">Unrecognized result version — rerun this check.</p>;

  const validCount = result.detected.filter((item) => item.valid).length;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <StatGrid
        stats={[
          ["Detected", result.detected.length],
          ["Valid", validCount],
          ["Missing", result.missingRecommended.length],
        ]}
      />

      {result.detected.length > 0 && (
        <ul className="divide-y divide-line rounded-[var(--radius-lg,5px)] border border-line">
          {result.detected.map((item) => (
            <li key={item.type} className="flex flex-col gap-1 px-3 py-2">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className={item.valid ? "text-score-strong" : "text-score-weak"}>
                  {item.valid ? "✓" : "✕"}
                </span>
                <span className="text-xs text-text-1">{item.type}</span>
                <span className="font-mono text-[10px] uppercase tracking-wide text-text-3">
                  {item.valid ? "Valid" : "Invalid"}
                </span>
              </div>
              {(item.errors.length > 0 || item.warnings.length > 0) && (
                <p className="text-[11px] text-text-3">{[...item.errors, ...item.warnings].join(" · ")}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {result.missingRecommended.length > 0 && (
        <p className="text-xs text-text-3">Missing recommended types: {result.missingRecommended.join(", ")}</p>
      )}

      {result.generated.map((gen) => (
        <div key={gen.type} className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-wider text-text-3">Generated {gen.type} JSON-LD</p>
          <pre className="mt-1 overflow-x-auto rounded-[var(--radius-lg,5px)] border border-line bg-surface-2 p-2.5 font-mono text-[11px] leading-relaxed text-text-2">
            {gen.jsonld}
          </pre>
        </div>
      ))}
    </div>
  );
}
