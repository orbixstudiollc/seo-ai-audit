import type { AgentStreamEvent } from "./types";

/**
 * SSE wire format for `POST /api/audit/agent` (DATA-CONTRACT §9) — same
 * `data:`-per-frame framing as lib/audit/stream.ts. Sibling pair:
 * `formatAgentEvent` (producer, used by app/api/audit/agent/route.ts) and
 * `parseAgentFrame` (consumer, used by useAgentStream/tests).
 */

/** Serialize one agent-mode event to an SSE frame. Used by the route handler. */
export function formatAgentEvent(event: AgentStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function parseAgentFrame(frame: string): AgentStreamEvent | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) return null;

  try {
    const parsed: unknown = JSON.parse(dataLines.join("\n"));
    if (parsed && typeof parsed === "object" && "type" in parsed) {
      return parsed as AgentStreamEvent;
    }
    return null;
  } catch {
    return null;
  }
}
