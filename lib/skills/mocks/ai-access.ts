import type { AiAccessSkillResult, SkillScope, SkillTask } from "@/lib/skills/types";

const scope: SkillScope = { kind: "site", url: "https://example.test" };

export const aiAccessMocks = {
  running: {
    id: "mock-ai-access-running",
    skillId: "ai-access",
    scope,
    status: "running",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:05.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
  },
  complete: {
    id: "mock-ai-access-complete",
    skillId: "ai-access",
    scope,
    status: "complete",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:06.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: {
      crawlers: [
        { name: "GPTBot", allowed: true },
        { name: "ClaudeBot", allowed: true },
        { name: "Google-Extended", allowed: false },
        { name: "PerplexityBot", allowed: "unspecified" },
        { name: "CCBot", allowed: false },
      ],
      llmsTxt: { present: true, hasSections: true, bytes: 1_240 },
    } satisfies AiAccessSkillResult,
  },
  failed: {
    id: "mock-ai-access-failed",
    skillId: "ai-access",
    scope,
    status: "failed",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:03.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
    error: { kind: "fetch_failed", message: "Could not fetch robots.txt." },
  },
} satisfies Record<"running" | "complete" | "failed", SkillTask<AiAccessSkillResult>>;
