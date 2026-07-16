import { describe, expect, it } from "vitest";
import type { AuditStreamEvent as LegacyAuditStreamEvent } from "@/lib/audit/types";
import { formatAuditEvent, parseAuditFrame } from "@/lib/audit/stream";
import type { AuditStreamEvent } from "@/lib/audit/mockReport";
import { mockReport } from "@/lib/audit/mockReport";
import {
  auditStreamReducer,
  INITIAL_AUDIT_STREAM_STATE,
  type AuditStreamState,
} from "@/app/hooks/useAuditStream";

/**
 * `auditStreamReducer` is the hook's pure accumulation logic (no fetch, no
 * React) — it folds one wire event into state, in the order the DATA-CONTRACT
 * guarantees: meta -> signals -> scores -> rewrites -> done, with error
 * possible at any point. Frames are built the same way the (future) /api/audit
 * route will build them — `formatAuditEvent` — then read back with
 * `parseAuditFrame`, so this also pins producer/consumer symmetry over the
 * wire, not just the reducer's switch statement.
 */

// Both functions only serialize/parse JSON by `type` — casting through the
// pre-pivot AuditStreamEvent bridges to the v1 contract shape until WS2 lands
// the type edit in lib/audit/types.ts (see mockReport.ts's contract-v1 note).
function roundTrip(event: AuditStreamEvent): AuditStreamEvent {
  const frame = formatAuditEvent(event as unknown as LegacyAuditStreamEvent);
  const parsed = parseAuditFrame(frame);
  expect(parsed).not.toBeNull();
  return parsed as unknown as AuditStreamEvent;
}

function fold(events: AuditStreamEvent[], initial: AuditStreamState = INITIAL_AUDIT_STREAM_STATE): AuditStreamState {
  return events.reduce((state, event) => auditStreamReducer(state, roundTrip(event)), initial);
}

describe("auditStreamReducer", () => {
  it("starts idle with nothing accumulated", () => {
    expect(INITIAL_AUDIT_STREAM_STATE).toEqual({
      phase: "idle",
      page: null,
      signals: null,
      scores: null,
      findings: null,
      rewrites: null,
      error: null,
    });
  });

  it("accumulates meta -> signals -> scores -> rewrites -> done in order", () => {
    const state = fold([
      { type: "meta", page: mockReport.page },
      { type: "signals", signals: mockReport.scores.signals as never },
      { type: "scores", scores: mockReport.scores, findings: mockReport.findings },
      { type: "rewrites", rewrites: mockReport.rewrites! },
      { type: "done" },
    ]);

    expect(state.phase).toBe("done");
    expect(state.page).toEqual(mockReport.page);
    expect(state.scores).toEqual(mockReport.scores);
    expect(state.findings).toEqual(mockReport.findings);
    expect(state.rewrites).toEqual(mockReport.rewrites);
    expect(state.error).toBeNull();
  });

  it("keeps whatever partial data already landed when an error frame arrives", () => {
    const state = fold([
      { type: "meta", page: mockReport.page },
      { type: "signals", signals: mockReport.scores.signals as never },
      { type: "error", kind: "server", message: "The provider timed out." },
    ]);

    expect(state.phase).toBe("error");
    expect(state.error).toEqual({ kind: "server", message: "The provider timed out.", retryAfter: undefined });
    // Partial data stays — the client never discards what it already rendered.
    expect(state.page).toEqual(mockReport.page);
    expect(state.signals).toEqual(mockReport.scores.signals);
    expect(state.scores).toBeNull();
  });

  it("carries retryAfter through a rate_limit error", () => {
    const state = fold([{ type: "error", kind: "rate_limit", message: "Slow down.", retryAfter: 30 }]);
    expect(state.error).toEqual({ kind: "rate_limit", message: "Slow down.", retryAfter: 30 });
  });

  it("reset (a fresh retry) clears prior state back to connecting", () => {
    const afterError = fold([{ type: "error", kind: "server", message: "boom" }]);
    const reset = auditStreamReducer(afterError, { type: "reset" });
    expect(reset).toEqual({ ...INITIAL_AUDIT_STREAM_STATE, phase: "connecting" });
  });

  it("ignores no event type it doesn't recognize (defensive default)", () => {
    const state = auditStreamReducer(INITIAL_AUDIT_STREAM_STATE, { type: "streaming" });
    expect(state).toEqual({ ...INITIAL_AUDIT_STREAM_STATE, phase: "streaming" });
  });
});
