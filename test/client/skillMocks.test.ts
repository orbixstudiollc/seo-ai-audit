import { describe, expect, it } from "vitest";
import { ALL_SKILL_MOCKS } from "@/lib/skills/mocks";

describe("skill mocks structural guards (DATA-CONTRACT §8 mock mandate)", () => {
  it("covers all 10 skills", () => {
    expect(ALL_SKILL_MOCKS.map((mock) => mock.skillId).sort()).toEqual(
      ["ai-access", "backlinks", "compare", "hreflang", "images", "keywords", "labs", "schema", "serp", "sitemap"].sort(),
    );
  });

  for (const { skillId, states } of ALL_SKILL_MOCKS) {
    for (const [state, task] of Object.entries(states)) {
      it(`${skillId}.${state} has a deterministic id and the declared skillId`, () => {
        expect(task.id).toBe(`mock-${skillId}-${state}`);
        expect(task.skillId).toBe(skillId);
      });

      if (state === "complete" || state === "emptyComplete") {
        it(`${skillId}.${state} carries a non-null, correctly versioned result`, () => {
          expect(task.status).toBe("complete");
          expect(task.result).not.toBeNull();
          expect(task.resultVersion).toBe(1);
        });
      }

      if (state === "failed") {
        it(`${skillId}.${state} carries a typed error`, () => {
          expect(task.status).toBe("failed");
          expect(task.error?.kind).toBeTruthy();
          expect(task.error?.message.length).toBeGreaterThan(0);
        });
      }
    }
  }
});
