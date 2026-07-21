import type { SerpSkillResult, SkillScope, SkillTask } from "@/lib/skills/types";

const scope: SkillScope = { kind: "keyword", keyword: "oat milk benefits" };

export const serpMocks = {
  running: {
    id: "mock-serp-running",
    skillId: "serp",
    scope,
    status: "running",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:05.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
  },
  complete: {
    id: "mock-serp-complete",
    skillId: "serp",
    scope,
    status: "complete",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:09.000Z",
    costUsd: 0.003,
    resultVersion: 1,
    result: {
      keyword: "oat milk benefits",
      capturedAt: "2026-07-20T09:00:09.000Z",
      entries: [
        { rank: 1, url: "https://healthline.example/oat-milk-benefits", title: "9 Benefits of Oat Milk", domain: "healthline.example", isOwn: false },
        { rank: 2, url: "https://example.test/guide-to-oat-milk", title: "The Complete Guide to Oat Milk", domain: "example.test", isOwn: true },
        { rank: 3, url: "https://foodnetwork.example/oat-milk", title: "Is Oat Milk Good for You?", domain: "foodnetwork.example", isOwn: false },
      ],
    } satisfies SerpSkillResult,
  },
  failed: {
    id: "mock-serp-failed",
    skillId: "serp",
    scope,
    status: "failed",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:03.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
    error: { kind: "provider_unavailable", message: "DataForSEO credentials are not configured on the server yet." },
  },
} satisfies Record<"running" | "complete" | "failed", SkillTask<SerpSkillResult>>;
