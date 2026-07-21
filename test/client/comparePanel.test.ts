import { describe, expect, it } from "vitest";
import { parseCompareFrame } from "@/app/components/skills/ComparePanel";

function frameFor(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

describe("parseCompareFrame", () => {
  it("parses a valid compare:progress frame", () => {
    const event = { type: "compare:progress", completed: 1, total: 3 };
    expect(parseCompareFrame(frameFor(event))).toEqual(event);
  });

  it("parses a valid compare:done frame", () => {
    const event = {
      type: "compare:done",
      task: {
        id: "task-1", skillId: "compare", scope: { kind: "keyword", keyword: "seo audit tool" }, status: "complete",
        createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:01.000Z", costUsd: 0.05, resultVersion: 1,
        result: { keyword: "seo audit tool", mine: { url: "https://example.test/", scores: null }, competitors: [] },
      },
    };
    expect(parseCompareFrame(frameFor(event))).toEqual(event);
  });

  it("returns null for garbage (unparsable JSON)", () => {
    expect(parseCompareFrame("data: {not json\n\n")).toBeNull();
  });

  it("returns null for a JSON payload with no type field", () => {
    expect(parseCompareFrame(`data: ${JSON.stringify({ completed: 1 })}\n\n`)).toBeNull();
  });

  it("returns null for a frame with no data: line", () => {
    expect(parseCompareFrame(": keepalive")).toBeNull();
  });
});
