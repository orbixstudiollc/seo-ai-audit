import type { AuditStreamEvent, SiteAuditStreamEvent } from "./types";

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

// -----------------------------------------------------------------------------
// Bulk site-crawl (WS4, additive — POST /api/audit/bulk only). Same wire
// format, a distinct event union (lib/audit/types.ts §"Bulk site-crawl").
// -----------------------------------------------------------------------------

/** Serialize one site-level event to an SSE frame. Used by the bulk route handler. */
export function formatSiteAuditEvent(event: SiteAuditStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Site-crawl sibling of parseAuditFrame, for useSiteAuditStream. */
export function parseSiteAuditFrame(frame: string): SiteAuditStreamEvent | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) return null;

  try {
    const parsed: unknown = JSON.parse(dataLines.join("\n"));
    if (parsed && typeof parsed === "object" && "type" in parsed) {
      return parsed as SiteAuditStreamEvent;
    }
    return null;
  } catch {
    return null;
  }
}

type SseWrite<E> = (event: E) => void;

/**
 * Generic hand-rolled SSE responder shared by both /api/audit and
 * /api/audit/bulk: heartbeat comment frames, close-once discipline, and
 * client-disconnect -> AbortSignal wiring. `run` gets a `write(event)` and
 * an `AbortSignal` that fires on client disconnect.
 */
export function createSseResponse<E>(
  formatEvent: (event: E) => string,
  run: (write: SseWrite<E>, signal: AbortSignal) => Promise<void>,
  opts?: { heartbeatMs?: number },
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const abortController = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write: SseWrite<E> = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(formatEvent(event)));
        } catch {
          closed = true;
        }
      };

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(HEARTBEAT_FRAME));
        } catch {
          closed = true;
        }
      }, opts?.heartbeatMs ?? 15_000);

      void run(write, abortController.signal).finally(() => {
        if (heartbeat) clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed or cancelled — nothing to do.
          }
        }
      });
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
