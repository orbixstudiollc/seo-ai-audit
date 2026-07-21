import { describe, expect, it } from "vitest";
import type { AgentStreamEvent } from "@/lib/skills/types";
import { parseAgentFrame } from "@/lib/skills/agentStream";

function frameFor(event: AgentStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

describe("parseAgentFrame", () => {
  it("parses a valid agent:plan frame", () => {
    const event: AgentStreamEvent = {
      type: "agent:plan",
      runId: "run-1",
      businessType: "saas",
      skills: [{ skillId: "schema", mode: "inline", estCostUsd: 0 }],
    };
    expect(parseAgentFrame(frameFor(event))).toEqual(event);
  });

  it("parses a valid agent:error frame", () => {
    const event: AgentStreamEvent = { type: "agent:error", kind: "budget_exceeded", message: "Over budget." };
    expect(parseAgentFrame(frameFor(event))).toEqual(event);
  });

  it("returns null for garbage (unparsable JSON)", () => {
    expect(parseAgentFrame("data: {not json\n\n")).toBeNull();
  });

  it("returns null for a JSON payload with no type field", () => {
    expect(parseAgentFrame(`data: ${JSON.stringify({ runId: "run-1" })}\n\n`)).toBeNull();
  });

  it("returns null for an empty frame (heartbeat comment, no data: line)", () => {
    expect(parseAgentFrame(": keepalive")).toBeNull();
  });

  it("returns null for a frame with no lines at all", () => {
    expect(parseAgentFrame("")).toBeNull();
  });
});
