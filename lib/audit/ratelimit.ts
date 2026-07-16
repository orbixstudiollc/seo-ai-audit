/**
 * Token-bucket rate limiter.
 *
 * ponytail: in-memory, per-instance. No Redis in this stack, and the product
 * ships as a self-hosted OSS dashboard that is normally a SINGLE instance —
 * for that shape an in-process bucket is the correct amount of machinery.
 * Known ceilings, and the upgrade path when either bites:
 *   - Resets on process restart (a restart hands everyone a full bucket).
 *   - Not shared across instances (N instances allow N× the limit).
 *   - The Map grows one entry per distinct key and is never swept.
 * Swap this single function for an Upstash counter or a Postgres
 * `rate_limit(key, tokens, updated_at)` row + `INCR`-style update if the deploy
 * ever becomes multi-instance; every caller already goes through here.
 */

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until one token is available again; 0 when allowed. */
  retryAfterSec: number;
}

/**
 * Consume one token from `key`'s bucket. `limit` tokens refill evenly over
 * `windowSec` (so the bucket also caps at `limit`). Allowed when a whole token
 * is available; otherwise reports how long until the next one.
 */
export function checkRateLimit(key: string, limit: number, windowSec: number): RateLimitResult {
  const now = Date.now();
  const refillPerMs = limit / (windowSec * 1000);
  const prev = buckets.get(key) ?? { tokens: limit, lastRefillMs: now };
  const refilled = Math.min(limit, prev.tokens + (now - prev.lastRefillMs) * refillPerMs);

  if (refilled >= 1) {
    buckets.set(key, { tokens: refilled - 1, lastRefillMs: now });
    return { allowed: true, retryAfterSec: 0 };
  }

  buckets.set(key, { tokens: refilled, lastRefillMs: now });
  const retryAfterSec = Math.max(1, Math.ceil((1 - refilled) / refillPerMs / 1000));
  return { allowed: false, retryAfterSec };
}
