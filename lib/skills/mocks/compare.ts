import type { CompareSkillResult, SkillScope, SkillTask } from "@/lib/skills/types";

const scope: SkillScope = { kind: "keyword", keyword: "oat milk benefits" };

export const compareMocks = {
  running: {
    id: "mock-compare-running",
    skillId: "compare",
    scope,
    status: "running",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:05.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
  },
  complete: {
    id: "mock-compare-complete",
    skillId: "compare",
    scope,
    status: "complete",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:14.000Z",
    costUsd: 0.05,
    resultVersion: 1,
    result: {
      keyword: "oat milk benefits",
      mine: {
        url: "https://example.test/guide-to-oat-milk",
        scores: { aeo: 65, geo: 55, citability: 50, aiOverview: 40 },
      },
      competitors: [
        {
          rank: 1,
          url: "https://healthline.example/oat-milk-benefits",
          scores: { aeo: 80, geo: 75, citability: 70, aiOverview: 78 },
          topFindings: ["Answers the question in the first two sentences.", "Cites a peer-reviewed nutrition study."],
        },
        {
          rank: 3,
          url: "https://foodnetwork.example/oat-milk",
          scores: { aeo: 60, geo: 50, citability: 45, aiOverview: 42 },
          topFindings: ["Thin on citations — mostly opinion."],
        },
      ],
    } satisfies CompareSkillResult,
  },
  failed: {
    id: "mock-compare-failed",
    skillId: "compare",
    scope,
    status: "failed",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:03.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
    error: { kind: "provider_unavailable", message: "DataForSEO credentials are not configured on the server yet." },
  },
} satisfies Record<"running" | "complete" | "failed", SkillTask<CompareSkillResult>>;
