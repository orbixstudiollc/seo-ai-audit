import type { HreflangSkillResult, SkillScope, SkillTask } from "@/lib/skills/types";

const scope: SkillScope = { kind: "page", url: "https://example.test/guide-to-oat-milk" };

export const hreflangMocks = {
  running: {
    id: "mock-hreflang-running",
    skillId: "hreflang",
    scope,
    status: "running",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:05.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
  },
  complete: {
    id: "mock-hreflang-complete",
    skillId: "hreflang",
    scope,
    status: "complete",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:06.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: {
      tags: [
        { hreflang: "en", href: "https://example.test/guide-to-oat-milk" },
        { hreflang: "fr", href: "https://example.test/fr/guide-du-lait-avoine" },
      ],
      checks: [
        { code: "self_reference", pass: true, detail: "The page references itself in its own hreflang set.", urls: [] },
        {
          code: "reciprocal_link",
          pass: false,
          detail: "The fr version does not link back to this page.",
          urls: ["https://example.test/fr/guide-du-lait-avoine"],
        },
      ],
    } satisfies HreflangSkillResult,
  },
  failed: {
    id: "mock-hreflang-failed",
    skillId: "hreflang",
    scope,
    status: "failed",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:03.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
    error: { kind: "fetch_failed", message: "Could not fetch the page to read its hreflang tags." },
  },
} satisfies Record<"running" | "complete" | "failed", SkillTask<HreflangSkillResult>>;
