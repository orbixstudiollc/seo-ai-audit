/**
 * POST /api/audit body validation. A 400 here means the SSE stream never
 * opens (DATA-CONTRACT §1) — so this runs before any Response is created.
 */

/** Contract §1: "url must be absolute http(s)://, ≤ 2048 chars." */
export const AUDIT_URL_MAX_LENGTH = 2048;

/**
 * Parses and validates the submitted URL. Returns the parsed `URL` on
 * success, `null` on anything that should 400 as `invalid_url` — not an
 * absolute string, too long, or a non-http(s) scheme. This is a shape check
 * only; reachability/SSRF safety is `lib/import`'s job (assertSafeUrl), run
 * later against the actual outbound fetch.
 */
export function parseAuditUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > AUDIT_URL_MAX_LENGTH) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed;
}
