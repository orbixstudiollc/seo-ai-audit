import { parseAuditFrame } from "@/lib/audit/stream";
import type { AuditStreamEvent } from "@/lib/audit/types";

/**
 * Drain an SSE Response body to completion and return the parsed audit events,
 * reusing the exact `parseAuditFrame` the real client hook uses so a wire-format
 * drift would fail these tests too. Heartbeat/comment frames parse to null and
 * are skipped. The stream self-closes once the route's `run` finishes, so this
 * resolves without an explicit abort.
 */
export async function collectSse(response: Response): Promise<AuditStreamEvent[]> {
  if (!response.body) throw new Error("Response has no body to stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: AuditStreamEvent[] = [];
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseAuditFrame(frame);
      if (event) events.push(event);
      boundary = buffer.indexOf("\n\n");
    }
  }

  return events;
}

/** The ordered list of event `type`s, for asserting the phase sequence. */
export function eventTypes(events: AuditStreamEvent[]): string[] {
  return events.map((e) => e.type);
}
