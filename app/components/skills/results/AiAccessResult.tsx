import type { AiAccessSkillResult, SkillTask } from "@/lib/skills/types";

function readResult(task: SkillTask): AiAccessSkillResult | null {
  if (task.resultVersion !== 1 || !task.result) return null;
  const result = task.result as Partial<AiAccessSkillResult>;
  if (!Array.isArray(result.crawlers) || !result.llmsTxt) return null;
  return result as AiAccessSkillResult;
}

function crawlerCue(allowed: boolean | "unspecified"): { glyph: string; label: string } {
  if (allowed === true) return { glyph: "✓", label: "Allowed" };
  if (allowed === false) return { glyph: "✕", label: "Blocked" };
  return { glyph: "—", label: "Unspecified" };
}

/** DATA-CONTRACT §8.1 AiAccessSkillResult renderer. */
export function AiAccessResult({ task }: { task: SkillTask }) {
  const result = readResult(task);
  if (!result) return <p className="text-xs text-text-3">Unrecognized result version — rerun this check.</p>;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ul className="divide-y divide-line rounded-[var(--radius-lg,5px)] border border-line">
        {result.crawlers.map((crawler) => {
          const cue = crawlerCue(crawler.allowed);
          return (
            <li key={crawler.name} className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-text-1">{crawler.name}</span>
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-text-3">
                <span aria-hidden="true">{cue.glyph}</span>
                {cue.label}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="font-mono text-[10px] uppercase tracking-wider text-text-3">
        llms.txt:{" "}
        {result.llmsTxt.present
          ? `present (${result.llmsTxt.bytes} bytes${result.llmsTxt.hasSections ? ", sectioned" : ""})`
          : "not found"}
      </p>
    </div>
  );
}
