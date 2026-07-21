import type { SitemapSkillResult, SkillTask } from "@/lib/skills/types";
import { StatGrid } from "../StatGrid";

function readResult(task: SkillTask): SitemapSkillResult | null {
  if (task.resultVersion !== 1 || !task.result) return null;
  const result = task.result as Partial<SitemapSkillResult>;
  if (typeof result.urlCount !== "number" || !Array.isArray(result.issues)) return null;
  return result as SitemapSkillResult;
}

/** DATA-CONTRACT §8.1 SitemapSkillResult renderer. */
export function SitemapResult({ task }: { task: SkillTask }) {
  const result = readResult(task);
  if (!result) return <p className="text-xs text-text-3">Unrecognized result version — rerun this check.</p>;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <StatGrid
        stats={[
          ["Sitemap URLs", result.urlCount],
          ["Same-origin", result.sameOriginCount],
          ["Issues", result.issues.length],
        ]}
      />

      {result.issues.length === 0 ? (
        <p className="text-xs text-text-3">No sitemap issues found.</p>
      ) : (
        <ul className="divide-y divide-line rounded-[var(--radius-lg,5px)] border border-line">
          {result.issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`} className="flex items-start gap-2 px-3 py-2">
              <span aria-hidden="true" className={issue.severity === "error" ? "text-score-weak" : "text-score-mid"}>
                {issue.severity === "error" ? "●" : "▪"}
              </span>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-text-3">{issue.severity}</span>
              <span className="min-w-0 text-xs text-text-2">{issue.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
