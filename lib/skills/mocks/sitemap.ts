import type { SitemapSkillResult, SkillScope, SkillTask } from "@/lib/skills/types";

const scope: SkillScope = { kind: "site", url: "https://example.test" };

export const sitemapMocks = {
  running: {
    id: "mock-sitemap-running",
    skillId: "sitemap",
    scope,
    status: "running",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:05.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
  },
  complete: {
    id: "mock-sitemap-complete",
    skillId: "sitemap",
    scope,
    status: "complete",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:07.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: {
      sitemapUrl: "https://example.test/sitemap.xml",
      declaredInRobots: true,
      urlCount: 214,
      sameOriginCount: 209,
      issues: [
        { code: "cross_origin_url", severity: "warning", detail: "5 URLs point to a different origin than the sitemap." },
        { code: "stale_lastmod", severity: "error", detail: "12 URLs have a lastmod date more than 2 years old." },
      ],
    } satisfies SitemapSkillResult,
  },
  emptyComplete: {
    id: "mock-sitemap-emptyComplete",
    skillId: "sitemap",
    scope,
    status: "complete",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:07.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: {
      sitemapUrl: "https://example.test/sitemap.xml",
      declaredInRobots: true,
      urlCount: 48,
      sameOriginCount: 48,
      issues: [],
    } satisfies SitemapSkillResult,
  },
  failed: {
    id: "mock-sitemap-failed",
    skillId: "sitemap",
    scope,
    status: "failed",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:03.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
    error: { kind: "fetch_failed", message: "Could not fetch sitemap.xml." },
  },
} satisfies Record<"running" | "complete" | "emptyComplete" | "failed", SkillTask<SitemapSkillResult>>;
