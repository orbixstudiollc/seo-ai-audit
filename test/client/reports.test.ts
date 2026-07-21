import { describe, expect, it } from "vitest";
import { isSavedReport, SAVED_REPORT_VERSION, type SavedAgentReport } from "@/lib/reports";
import { INITIAL_AGENT_STREAM_STATE } from "@/app/hooks/useAgentStream";

/**
 * isSavedReport's "agent" branch (SK3) — same looseness as the existing
 * "single"/"site" cases: version/id/createdAt/phase/kind + a present state
 * object (and, for agent, a url string — AgentStreamState carries none of
 * its own, unlike the single/site reports).
 */

function agentReport(overrides: Partial<SavedAgentReport> = {}): SavedAgentReport {
  return {
    version: SAVED_REPORT_VERSION,
    id: "agent:https://example.com/:2026-07-21T00:00:00.000Z",
    kind: "agent",
    createdAt: "2026-07-21T00:00:00.000Z",
    phase: "done",
    url: "https://example.com/",
    state: { ...INITIAL_AGENT_STREAM_STATE, phase: "done" },
    ...overrides,
  };
}

describe("isSavedReport — agent kind", () => {
  it("accepts a well-formed done agent report", () => {
    expect(isSavedReport(agentReport())).toBe(true);
  });

  it("accepts an error-phase agent report", () => {
    expect(isSavedReport(agentReport({ phase: "error", state: { ...INITIAL_AGENT_STREAM_STATE, phase: "error" } }))).toBe(true);
  });

  it("rejects a phase outside done/error", () => {
    // "confirm" isn't a settled phase — nothing should ever be persisted mid-run.
    expect(isSavedReport({ ...agentReport(), phase: "confirm" })).toBe(false);
  });

  it("rejects a missing state object", () => {
    const withoutState: Record<string, unknown> = { ...agentReport() };
    delete withoutState.state;
    expect(isSavedReport(withoutState)).toBe(false);
  });

  it("rejects a missing url", () => {
    const withoutUrl: Record<string, unknown> = { ...agentReport() };
    delete withoutUrl.url;
    expect(isSavedReport(withoutUrl)).toBe(false);
  });

  it("rejects the wrong version", () => {
    expect(isSavedReport({ ...agentReport(), version: 2 })).toBe(false);
  });
});
