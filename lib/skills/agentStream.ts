import type { AgentStreamEvent } from "./types";

/**
 * SSE wire format for `POST /api/audit/agent` (DATA-CONTRACT §9) — same
 * `data:`-per-frame framing as lib/audit/stream.ts, parsing the agent-mode
 * event union instead. Sibling of parseAuditFrame/parseSiteAuditFrame; no
 * producer-side formatter yet because the real route doesn't exist (SK3).
 */
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
