import { describe, expect, it } from "vitest";
import { isHistoryRecord, type AgentAuditHistoryDetails, type AuditHistoryRecord } from "@/lib/history";

/**
 * isHistoryRecord's "agent" mode (SK3) — new mode literal plus the
 * AgentAuditHistoryDetails variant (bounded, non-negative ints).
 */

function agentDetails(overrides: Partial<AgentAuditHistoryDetails> = {}): AgentAuditHistoryDetails {
  return { kind: "agent", skillsRun: 3, skillsFailed: 1, pendingCount: 0, ...overrides };
}

function agentRecord(overrides: Partial<AuditHistoryRecord> = {}): AuditHistoryRecord {
  return {
    id: "agent:https://example.com/:2026-07-21T00:00:00.000Z",
    version: 4,
    url: "https://example.com/",
    title: "example.com",
    mode: "agent",
    createdAt: "2026-07-21T00:00:00.000Z",
    status: "partial",
    scores: null,
    details: agentDetails(),
    ...overrides,
  };
}

describe("isHistoryRecord — agent mode", () => {
  it("accepts a well-formed agent record with details", () => {
    expect(isHistoryRecord(agentRecord())).toBe(true);
  });

  it("accepts an agent record with an error message", () => {
    expect(isHistoryRecord(agentRecord({ details: agentDetails({ errorMessage: "Budget exceeded." }) }))).toBe(true);
  });

  it("rejects negative counts", () => {
    expect(isHistoryRecord(agentRecord({ details: agentDetails({ skillsFailed: -1 }) }))).toBe(false);
  });

  it("rejects non-integer counts", () => {
    expect(isHistoryRecord(agentRecord({ details: agentDetails({ pendingCount: 1.5 }) }))).toBe(false);
  });

  it("rejects an unknown mode literal", () => {
    expect(isHistoryRecord({ ...agentRecord(), mode: "bulk" })).toBe(false);
  });

  it("scores must still be null or a full Lens record — agent runs never produce lens scores", () => {
    expect(isHistoryRecord(agentRecord({ scores: { aeo: 1, geo: 1, citability: 1, aiOverview: 1 } }))).toBe(true);
    expect(isHistoryRecord({ ...agentRecord(), scores: {} })).toBe(false);
  });
});
