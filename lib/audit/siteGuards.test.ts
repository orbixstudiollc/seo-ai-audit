import { describe, expect, it } from "vitest";
import {
  acquireCrawlSlot,
  releaseCrawlSlot,
  checkBulkRateLimit,
  createSiteBudget,
  runConcurrentQueue,
} from "./siteGuards";

describe("acquireCrawlSlot / releaseCrawlSlot", () => {
  it("grants one slot per IP and blocks a second concurrent request", () => {
    const ip = "203.0.113.1";
    expect(acquireCrawlSlot(ip)).toBe(true);
    expect(acquireCrawlSlot(ip)).toBe(false);
    releaseCrawlSlot(ip);
    expect(acquireCrawlSlot(ip)).toBe(true);
    releaseCrawlSlot(ip);
  });

  it("tracks different IPs independently", () => {
    expect(acquireCrawlSlot("203.0.113.2")).toBe(true);
    expect(acquireCrawlSlot("203.0.113.3")).toBe(true);
    releaseCrawlSlot("203.0.113.2");
    releaseCrawlSlot("203.0.113.3");
  });
});

describe("checkBulkRateLimit", () => {
  it("allows the first requests then blocks once the hourly bucket is spent", () => {
    const ip = `bulk-rl-${Math.random()}`;
    const first = checkBulkRateLimit(ip);
    const second = checkBulkRateLimit(ip);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    const third = checkBulkRateLimit(ip);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSec).toBeGreaterThan(0);
  });
});

describe("createSiteBudget", () => {
  it("is not expired immediately and reports positive remaining time", () => {
    const budget = createSiteBudget(10_000);
    expect(budget.expired()).toBe(false);
    expect(budget.remainingMs()).toBeGreaterThan(0);
  });

  it("is expired immediately for a zero-length budget", () => {
    const budget = createSiteBudget(0);
    expect(budget.expired()).toBe(true);
    expect(budget.remainingMs()).toBe(0);
  });
});

describe("runConcurrentQueue", () => {
  it("runs every item with the given concurrency cap", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    const seen: number[] = [];

    const { stoppedEarly } = await runConcurrentQueue(items, 3, createSiteBudget(10_000), async (item) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(item);
      inFlight--;
    });

    expect(seen.sort((a, b) => a - b)).toEqual(items);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(stoppedEarly).toBe(false);
  });

  it("stops enqueueing new work once the budget expires, leaves in-flight work to finish", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const budget = createSiteBudget(15); // expires almost immediately
    const seen: number[] = [];

    const { stoppedEarly } = await runConcurrentQueue(items, 2, budget, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      seen.push(item);
    });

    expect(stoppedEarly).toBe(true);
    expect(seen.length).toBeLessThan(items.length);
    expect(seen.length).toBeGreaterThan(0); // the already-started items still completed
  });

  it("reports stoppedEarly=false when everything finishes within budget", async () => {
    const items = [1, 2, 3];
    const { stoppedEarly } = await runConcurrentQueue(items, 2, createSiteBudget(10_000), async () => {});
    expect(stoppedEarly).toBe(false);
  });
});
