import { checkRateLimit, type RateLimitResult } from "./ratelimit";

/**
 * Abuse/cost controls specific to the anonymous bulk site-crawl endpoint. A
 * single crawl fans out to up to DISCOVERY_HARD_MAX pages, each spending 2
 * LLM calls — potentially hundreds of times a single /api/audit request — so it needs its own,
 * stricter set of guards on top of what the single-page route already has.
 */

// Deliberately much tighter than the single-page limits (5/min, 20/day) —
// one bulk request is worth dozens of single audits in server-key spend.
const BULK_IP_LIMIT_PER_HOUR = 2;
const BULK_IP_WINDOW_HOUR_SEC = 60 * 60;
const BULK_IP_LIMIT_PER_DAY = 5;
const BULK_IP_WINDOW_DAY_SEC = 24 * 60 * 60;

export function checkBulkRateLimit(ip: string): RateLimitResult {
  const hourLimit = checkRateLimit(`audit:bulk:ip:hour:${ip}`, BULK_IP_LIMIT_PER_HOUR, BULK_IP_WINDOW_HOUR_SEC);
  if (!hourLimit.allowed) return hourLimit;
  return checkRateLimit(`audit:bulk:ip:day:${ip}`, BULK_IP_LIMIT_PER_DAY, BULK_IP_WINDOW_DAY_SEC);
}

/**
 * Per-IP concurrent-site-crawl mutex: only one bulk crawl in flight per IP at
 * a time. A crawl already fans out to many pages at SITE_MAX_CONCURRENCY
 * each — letting the same IP start a second one multiplies that for free.
 * ponytail: in-memory per-instance Set, same shape/ceiling as
 * ratelimit.ts's bucket map (resets on restart, not shared across
 * instances) — matches the rest of this stateless, single-instance
 * anonymous-tool deployment. Upgrade path is the same one ratelimit.ts
 * documents if this ever becomes multi-instance.
 */
const activeCrawls = new Set<string>();

/** Returns true and reserves the slot if `ip` has no crawl in flight; false if it does. */
export function acquireCrawlSlot(ip: string): boolean {
  if (activeCrawls.has(ip)) return false;
  activeCrawls.add(ip);
  return true;
}

export function releaseCrawlSlot(ip: string): void {
  activeCrawls.delete(ip);
}

export interface SiteBudget {
  expired(): boolean;
  remainingMs(): number;
}

/** Wall-clock budget for one site run — the queue stops enqueueing new pages once this expires. */
export function createSiteBudget(budgetMs: number): SiteBudget {
  const deadline = Date.now() + budgetMs;
  return {
    expired: () => Date.now() >= deadline,
    remainingMs: () => Math.max(0, deadline - Date.now()),
  };
}

/**
 * Runs `items` through `worker` with at most `concurrency` in flight at once,
 * stopping cleanly (no new work started, in-flight work left to finish) once
 * `budget` expires — the "cost ceiling that stops the queue cleanly"
 * behavior. No new dependency: this is the entire shape a bounded-concurrency
 * queue needs for this use case.
 */
export async function runConcurrentQueue<T>(
  items: readonly T[],
  concurrency: number,
  budget: SiteBudget,
  worker: (item: T, index: number) => Promise<void>,
): Promise<{ stoppedEarly: boolean }> {
  let cursor = 0;
  let stoppedEarly = false;

  async function runNext(): Promise<void> {
    if (budget.expired()) {
      if (cursor < items.length) stoppedEarly = true;
      return;
    }
    const index = cursor++;
    if (index >= items.length) return;
    const item = items[index] as T;
    await worker(item, index);
    await runNext();
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
  return { stoppedEarly };
}
