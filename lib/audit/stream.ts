import type { AuditStreamEvent } from "./types";

/**
 * SSE wire format shared by the /api/audit route (producer) and the
 * useAuditStream hook (consumer). One JSON object per SSE `data:` frame,
 * frames separated by a blank line. Comment frames (`:` heartbeat) carry no
 * data and are ignored by the parser.
 */

/** Serialize one event to an SSE frame. Used by the route handler. */
export function formatAuditEvent(event: AuditStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Heartbeat comment frame to keep idle proxies from killing the connection. */
export const HEARTBEAT_FRAME = ": keepalive\n\n";

/**
 * Parse one raw frame (the text between blank-line delimiters) into an event.
 * Returns null for heartbeats, empty frames, or malformed payloads — the
 * consumer skips nulls rather than tearing down the stream on a stray frame.
 */
export function parseAuditFrame(frame: string): AuditStreamEvent | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) return null;

  try {
    const parsed: unknown = JSON.parse(dataLines.join("\n"));
    if (parsed && typeof parsed === "object" && "type" in parsed) {
      return parsed as AuditStreamEvent;
    }
    return null;
  } catch {
    return null;
  }
}
