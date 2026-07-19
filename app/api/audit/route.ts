import { z } from "zod";
import { checkRateLimit } from "@/lib/audit/ratelimit";
import { parseAuditUrl } from "@/lib/audit/requestValidation";
import { createSseResponse, formatAuditEvent } from "@/lib/audit/stream";
import { runPageAudit } from "@/lib/audit/pageAudit";
import { jsonError, clientIp } from "@/lib/audit/httpHelpers";

/**
 * POST /api/audit — anonymous, stateless (docs/DATA-CONTRACT.md v1.0).
 * SSRF-guarded fetch -> Readability extraction -> @aeo/scoring -> two server-key
 * LLM calls -> SSE stream. No auth, no DB, nothing persisted; the client holds
 * the whole report once the stream completes. The pipeline itself lives in
 * lib/audit/pageAudit.ts (shared verbatim with the bulk site-crawl route,
 * WS4) — this route is just rate-limiting, request validation, and SSE
 * framing (lib/audit/stream.ts's createSseResponse) around one call to it.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

// Anonymous + no auth means the per-IP bucket is the ONLY abuse control, so
// it's deliberately tight (an audit spends the server's own ANTHROPIC_API_KEY).
const AUDIT_IP_LIMIT_PER_MINUTE = 5;
const AUDIT_IP_WINDOW_MINUTE_SEC = 60;
const AUDIT_IP_LIMIT_PER_DAY = 20;
const AUDIT_IP_WINDOW_DAY_SEC = 24 * 60 * 60;

// lib/import's own default is 10s; the spec caps this route at 15s.
const FETCH_TIMEOUT_MS = 15_000;

const bodySchema = z.object({ url: z.string() });

// -----------------------------------------------------------------------------
// POST /api/audit
// -----------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  // 1. Per-IP rate limit — the only abuse control available with no auth.
  const ip = clientIp(req);
  const minuteLimit = checkRateLimit(
    `audit:ip:min:${ip}`,
    AUDIT_IP_LIMIT_PER_MINUTE,
    AUDIT_IP_WINDOW_MINUTE_SEC,
  );
  const dayLimit = checkRateLimit(`audit:ip:day:${ip}`, AUDIT_IP_LIMIT_PER_DAY, AUDIT_IP_WINDOW_DAY_SEC);
  const limited = !minuteLimit.allowed ? minuteLimit : !dayLimit.allowed ? dayLimit : null;
  if (limited) {
    return jsonError(
      429,
      { error: "rate_limit", retryAfter: limited.retryAfterSec },
      { "Retry-After": String(limited.retryAfterSec) },
    );
  }

  // 2. Parse + validate the body. Any failure here 400s BEFORE the stream opens.
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError(400, { error: "invalid_url", message: "Request body must be JSON." });
  }
  const parsedBody = bodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return jsonError(400, { error: "invalid_url", message: "Request body must include a url." });
  }
  const submittedUrl = parsedBody.data.url;
  const targetUrl = parseAuditUrl(submittedUrl);
  if (!targetUrl) {
    return jsonError(400, {
      error: "invalid_url",
      message: "That doesn't look like a valid http(s) URL.",
    });
  }

  // 3. Stream: fetch -> extract -> DET signals -> rubric call -> rewrite call.
  return createSseResponse(formatAuditEvent, (write, signal) =>
    runPageAudit(submittedUrl, targetUrl, write, { fetchTimeoutMs: FETCH_TIMEOUT_MS, signal }),
  );
}
