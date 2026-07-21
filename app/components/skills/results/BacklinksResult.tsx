import type { BacklinksSkillResult, SkillTask } from "@/lib/skills/types";
import { StatGrid } from "../StatGrid";

function readResult(task: SkillTask): BacklinksSkillResult | null {
  if (task.resultVersion !== 1 || !task.result) return null;
  const result = task.result as Partial<BacklinksSkillResult>;
  if (typeof result.totalBacklinks !== "number" || typeof result.referringDomains !== "number") return null;
  return result as BacklinksSkillResult;
}

/** DATA-CONTRACT §8.1 BacklinksSkillResult renderer. */
export function BacklinksResult({ task }: { task: SkillTask }) {
  const result = readResult(task);
  if (!result) return <p className="text-xs text-text-3">Unrecognized result version — rerun this check.</p>;

  return (
    <StatGrid
      stats={[
        ["Total backlinks", result.totalBacklinks],
        ["Referring domains", result.referringDomains],
        ["Domain rank", result.rank ?? "—"],
        ["Broken backlinks", result.brokenBacklinks],
        ["Nofollow domains", result.referringDomainsNofollow],
      ]}
    />
  );
}
