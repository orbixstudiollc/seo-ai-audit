import type { LabsSkillResult, SkillScope, SkillTask } from "@/lib/skills/types";

const scope: SkillScope = { kind: "site", url: "https://example.test" };

export const labsMocks = {
  running: {
    id: "mock-labs-running",
    skillId: "labs",
    scope,
    status: "running",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:05.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
  },
  complete: {
    id: "mock-labs-complete",
    skillId: "labs",
    scope,
    status: "complete",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:10.000Z",
    costUsd: 0.01,
    resultVersion: 1,
    result: {
      rows: [
        { keyword: "oat milk guide", position: 3, volume: 2_900, url: "https://example.test/guide-to-oat-milk" },
        { keyword: "oat milk recipes", position: 8, volume: 5_400, url: "https://example.test/recipes" },
        { keyword: "best oat milk brands", position: 14, volume: 3_600, url: null },
      ],
    } satisfies LabsSkillResult,
  },
  failed: {
    id: "mock-labs-failed",
    skillId: "labs",
    scope,
    status: "failed",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:03.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
    error: { kind: "provider_unavailable", message: "DataForSEO credentials are not configured on the server yet." },
  },
} satisfies Record<"running" | "complete" | "failed", SkillTask<LabsSkillResult>>;
