import type { KeywordsSkillResult, SkillScope, SkillTask } from "@/lib/skills/types";

const scope: SkillScope = { kind: "keyword", keyword: "oat milk" };

export const keywordsMocks = {
  running: {
    id: "mock-keywords-running",
    skillId: "keywords",
    scope,
    status: "running",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:05.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
  },
  complete: {
    id: "mock-keywords-complete",
    skillId: "keywords",
    scope,
    status: "complete",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:09.000Z",
    costUsd: 0.01,
    resultVersion: 1,
    result: {
      rows: [
        { keyword: "oat milk", volume: 90_500, cpc: 0.82, competition: 0.34 },
        { keyword: "oat milk benefits", volume: 14_800, cpc: 0.55, competition: 0.22 },
        { keyword: "is oat milk healthy", volume: 6_600, cpc: 0.41, competition: 0.18 },
        { keyword: "oat milk vs almond milk", volume: 8_100, cpc: null, competition: null },
      ],
    } satisfies KeywordsSkillResult,
  },
  failed: {
    id: "mock-keywords-failed",
    skillId: "keywords",
    scope,
    status: "failed",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:03.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
    error: { kind: "provider_unavailable", message: "DataForSEO credentials are not configured on the server yet." },
  },
} satisfies Record<"running" | "complete" | "failed", SkillTask<KeywordsSkillResult>>;
