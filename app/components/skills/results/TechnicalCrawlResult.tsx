import type { SkillTask } from "@/lib/skills/types";
import { StatGrid } from "../StatGrid";

interface LooseTechnicalCrawlResult {
  pagesCrawled?: number;
  onpageScore?: number | null;
}

/**
 * Minimal renderer for the technical-crawl handoff skill (added for SK2's
 * agent-mode handoff wiring — DATA-CONTRACT §8 note: technical-crawl
 * "retrofits onto this envelope" but has no typed SkillResultMap entry yet,
 * unlike the §8.1 free skills). Reads defensively and degrades to "—" rather
 * than asserting a shape SK3's real orchestrator hasn't landed yet.
 */
export function TechnicalCrawlResult({ task }: { task: SkillTask }) {
  const result = (task.result ?? {}) as LooseTechnicalCrawlResult;
  const pagesCrawled = typeof result.pagesCrawled === "number" ? result.pagesCrawled : "—";
  const onpageScore = typeof result.onpageScore === "number" ? Math.round(result.onpageScore) : "—";

  return (
    <StatGrid
      stats={[
        ["Pages crawled", pagesCrawled],
        ["On-page score", onpageScore],
      ]}
    />
  );
}
