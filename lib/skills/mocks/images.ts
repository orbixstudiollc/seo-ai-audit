import type { ImagesSkillResult, SkillScope, SkillTask } from "@/lib/skills/types";

const scope: SkillScope = { kind: "page", url: "https://example.test/guide-to-oat-milk" };

export const imagesMocks = {
  running: {
    id: "mock-images-running",
    skillId: "images",
    scope,
    status: "running",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:05.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
  },
  complete: {
    id: "mock-images-complete",
    skillId: "images",
    scope,
    status: "complete",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:07.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: {
      imageCount: 12,
      missingAlt: [
        "https://example.test/images/oat-milk-pour.jpg",
        "https://example.test/images/oat-milk-carton.jpg",
      ],
      oversized: [{ url: "https://example.test/images/oat-milk-hero.png", bytes: 2_621_440 }],
      issues: [{ code: "missing_alt", count: 2, urls: ["https://example.test/images/oat-milk-pour.jpg"] }],
    } satisfies ImagesSkillResult,
  },
  emptyComplete: {
    id: "mock-images-emptyComplete",
    skillId: "images",
    scope,
    status: "complete",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:07.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: {
      imageCount: 6,
      missingAlt: [],
      oversized: [],
      issues: [],
    } satisfies ImagesSkillResult,
  },
  failed: {
    id: "mock-images-failed",
    skillId: "images",
    scope,
    status: "failed",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:03.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
    error: { kind: "fetch_failed", message: "Could not fetch the page to inspect its images." },
  },
} satisfies Record<"running" | "complete" | "emptyComplete" | "failed", SkillTask<ImagesSkillResult>>;
