import type { SchemaSkillResult, SkillScope, SkillTask } from "@/lib/skills/types";

/**
 * DATA-CONTRACT §8 mock mandate — every lifecycle state the Schema renderer
 * uses. Deterministic ids/timestamps so tests and dev-page snapshots stay
 * stable across runs.
 */

const scope: SkillScope = { kind: "page", url: "https://example.test/guide-to-oat-milk" };

export const schemaMocks = {
  running: {
    id: "mock-schema-running",
    skillId: "schema",
    scope,
    status: "running",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:05.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
  },
  complete: {
    id: "mock-schema-complete",
    skillId: "schema",
    scope,
    status: "complete",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:08.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: {
      detected: [
        { type: "Article", valid: true, errors: [], warnings: [] },
        { type: "BreadcrumbList", valid: false, errors: ['Missing required property "itemListElement"'], warnings: [] },
      ],
      missingRecommended: ["FAQPage"],
      generated: [
        {
          type: "FAQPage",
          jsonld: JSON.stringify(
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: [
                {
                  "@type": "Question",
                  name: "Is oat milk gluten-free?",
                  acceptedAnswer: { "@type": "Answer", text: "Most oat milk is gluten-free when made from certified gluten-free oats." },
                },
              ],
            },
            null,
            2,
          ),
        },
      ],
    } satisfies SchemaSkillResult,
  },
  failed: {
    id: "mock-schema-failed",
    skillId: "schema",
    scope,
    status: "failed",
    createdAt: "2026-07-20T09:00:00.000Z",
    updatedAt: "2026-07-20T09:00:03.000Z",
    costUsd: 0,
    resultVersion: 1,
    result: null,
    error: { kind: "fetch_failed", message: "Could not fetch the page to inspect its structured data." },
  },
} satisfies Record<"running" | "complete" | "failed", SkillTask<SchemaSkillResult>>;
