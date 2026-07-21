import type { BacklinksSkillResult, SkillScope, SkillTask } from "@/lib/skills/types";

const scope: SkillScope = { kind: "site", url: "https://example.test" };

export const backlinksMocks = {
  running: {
    id: "mock-backlinks-running",
    skillId: "backlinks",
    scope,
    status: "running",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:05.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
  },
  complete: {
    id: "mock-backlinks-complete",
    skillId: "backlinks",
    scope,
    status: "complete",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:11.000Z",
    costUsd: 0.02,
    resultVersion: 1,
    result: {
      totalBacklinks: 1_284,
      referringDomains: 96,
      rank: 41,
      brokenBacklinks: 7,
      referringDomainsNofollow: 22,
    } satisfies BacklinksSkillResult,
  },
  emptyComplete: {
    id: "mock-backlinks-emptyComplete",
    skillId: "backlinks",
    scope,
    status: "complete",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:11.000Z",
    costUsd: 0.02,
    resultVersion: 1,
    result: {
      totalBacklinks: 0,
      referringDomains: 0,
      rank: null,
      brokenBacklinks: 0,
      referringDomainsNofollow: 0,
    } satisfies BacklinksSkillResult,
  },
  failed: {
    id: "mock-backlinks-failed",
    skillId: "backlinks",
    scope,
    status: "failed",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:03.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
    error: { kind: "provider_unavailable", message: "DataForSEO credentials are not configured on the server yet." },
  },
} satisfies Record<"running" | "complete" | "emptyComplete" | "failed", SkillTask<BacklinksSkillResult>>;
