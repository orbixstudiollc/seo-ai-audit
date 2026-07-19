import { z } from "zod";
import { discoverPages, DISCOVERY_HARD_MAX } from "@/lib/discovery/discoverPages";
import { ImportError } from "@/lib/import";
import { parseAuditUrl } from "@/lib/audit/requestValidation";
import { createSseResponse, formatSiteAuditEvent } from "@/lib/audit/stream";
import { runPageAudit } from "@/lib/audit/pageAudit";
import { jsonError, clientIp } from "@/lib/audit/httpHelpers";
import {
  checkBulkRateLimit,
  acquireCrawlSlot,
  releaseCrawlSlot,
  createSiteBudget,
  runConcurrentQueue,
} from "@/lib/audit/siteGuards";
import { computeSiteRollup, type PageAuditResult } from "@/lib/audit/siteRollup";
import type { AuditFindings, AuditStreamEvent, DiscoveredPageInfo, PageMeta, ScoreBreakdown, SiteAuditStreamEvent } from "@/lib/audit/types";

/**
 * POST /api/audit/bulk — anonymous, stateless whole-site audit (docs/DATA-CONTRACT.md
 * §7, additive on top of v1.0). Discovers same-origin pages (sitemap.xml first,
 * link-crawl fallback — lib/discovery), then runs lib/audit/pageAudit.ts's
 * runPageAudit verbatim per page under bounded concurrency, streaming
 * site-level events that wrap each page's own AuditStreamEvent. Every fetch
 * this makes, direct or through discovery, goes through the SSRF-pinned
 * dispatcher (lib/import/ssrfGuard.ts) — crawling multiplies fetch surface,
 * it does not loosen the guard.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------

const SITE_MAX_CONCURRENCY = 3;
// Leaves headroom under maxDuration for discovery + the final rollup write.
const SITE_WALL_CLOCK_BUDGET_MS = 240_000;
// Whole-page hard cap (fetch + both LLM calls) — independent of, and tighter
// than, the 300s route-level maxDuration a single page could otherwise eat.
const PAGE_TIMEOUT_MS = 45_000;
// Same as the single-page route's own fetch timeout.
const PAGE_FETCH_TIMEOUT_MS = 15_000;

const bodySchema = z.object({
  url: z.string(),
  limit: z.number().int().min(1).max(DISCOVERY_HARD_MAX).optional(),
  pages: z.array(z.string().min(1).max(2048)).min(1).max(DISCOVERY_HARD_MAX).optional(),
}).refine((body) => body.pages === undefined || body.limit === undefined, {
  message: "Use either discovery limit or explicit retry pages.",
  path: ["pages"],
});

// -----------------------------------------------------------------------------
// One page, wrapped for the site queue
// -----------------------------------------------------------------------------

/**
 * Runs one page through runPageAudit, forwarding every event wrapped in
 * `site:page-event`, and returns what the rollup needs. Enforces
 * PAGE_TIMEOUT_MS as a real race (not just an AbortSignal) because
 * runAudit's call-1 has no abort wiring (see pageAudit.ts's own comment on
 * this pre-existing limitation) — a stuck call-1 can't be cancelled, but it
 * can be raced past so the QUEUE keeps moving and the page is reported as
 * failed rather than stalling every other page behind it.
 */
async function runOnePage(
  pageUrl: string,
  index: number,
  siteWrite: (event: SiteAuditStreamEvent) => void,
  parentSignal: AbortSignal,
): Promise<PageAuditResult> {
  let targetUrl: URL;
  try {
    targetUrl = new URL(pageUrl);
  } catch {
    siteWrite({
      type: "site:page-event",
      url: pageUrl,
      index,
      event: { type: "error", kind: "invalid_url", message: "Invalid page URL." },
    });
    return { url: pageUrl, status: "error", page: null, scores: null, findings: null };
  }

  const pageController = new AbortController();
  const onParentAbort = (): void => pageController.abort(parentSignal.reason);
  if (parentSignal.aborted) onParentAbort();
  else parentSignal.addEventListener("abort", onParentAbort);

  let finished = false;
  let capturedPage: PageMeta | null = null;
  let capturedScores: ScoreBreakdown | null = null;
  let capturedFindings: AuditFindings | null = null;
  let status: "ok" | "error" = "error";

  const wrappedWrite = (event: AuditStreamEvent): void => {
    if (finished) return; // drop late events from a run we already gave up on (timeout race lost)
    if (event.type === "meta") capturedPage = event.page;
    if (event.type === "scores") {
      capturedScores = event.scores;
      capturedFindings = event.findings;
    }
    if (event.type === "done") {
      finished = true;
      status = "ok";
    }
    if (event.type === "error") {
      finished = true;
      status = "error";
    }
    siteWrite({ type: "site:page-event", url: pageUrl, index, event });
  };

  const auditPromise = runPageAudit(pageUrl, targetUrl, wrappedWrite, {
    fetchTimeoutMs: PAGE_FETCH_TIMEOUT_MS,
    signal: pageController.signal,
  }).catch(() => undefined); // runPageAudit is designed never to throw; stay defensive anyway

  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => {
      pageController.abort(new Error("page_timeout"));
      resolve();
    }, PAGE_TIMEOUT_MS);
  });

  await Promise.race([auditPromise, timeoutPromise]);
  clearTimeout(timeoutHandle!);
  parentSignal.removeEventListener("abort", onParentAbort);

  if (!finished) {
    wrappedWrite({
      type: "error",
      kind: "server",
      message: "This page took too long to audit and was skipped.",
    });
  }

  return { url: pageUrl, status, page: capturedPage, scores: capturedScores, findings: capturedFindings };
}

// -----------------------------------------------------------------------------
// Whole-site run
// -----------------------------------------------------------------------------

async function runSiteAudit(
  rootUrl: string,
  limit: number | undefined,
  requestedPages: { url: string; source: "retry" }[] | undefined,
  write: (event: SiteAuditStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  write({ type: "site:discovery-start", rootUrl });

  const discovery = requestedPages
    ? { rootUrl, method: "retry" as const, pages: requestedPages, truncated: false }
    : await discoverPages(rootUrl, { limit, signal }).catch((err: unknown) => {
        const invalidUrl = err instanceof ImportError && err.kind === "blocked";
        write({
          type: "site:error",
          kind: invalidUrl ? "invalid_url" : "server",
          message: err instanceof ImportError ? err.message : "Could not discover pages on this site.",
        });
        return null;
      });
  if (discovery === null) return;

  if (discovery.pages.length === 0) {
    write({ type: "site:error", kind: "no_pages_found", message: "No pages were found to audit on this site." });
    return;
  }

  write({
    type: "site:discovery-done",
    rootUrl: discovery.rootUrl,
    method: discovery.method,
    pages: discovery.pages,
    truncated: discovery.truncated,
  });

  if (signal.aborted) return;

  const pages: DiscoveredPageInfo[] = discovery.pages;
  const budget = createSiteBudget(SITE_WALL_CLOCK_BUDGET_MS);
  const results: PageAuditResult[] = [];

  const { stoppedEarly } = await runConcurrentQueue(pages, SITE_MAX_CONCURRENCY, budget, async (page, index) => {
    if (signal.aborted) return;
    write({ type: "site:page-start", url: page.url, index, total: pages.length });
    const outcome = await runOnePage(page.url, index, write, signal);
    results[index] = outcome;
    write({ type: "site:page-done", url: page.url, index, status: outcome.status });
  });

  const completed = results.filter((r): r is PageAuditResult => r !== undefined);
  const rollup = computeSiteRollup(completed);
  const stoppedEarlyInfo = stoppedEarly
    ? { reason: "budget" as const, pagesRemaining: pages.length - completed.length }
    : null;
  write({ type: "site:rollup", rollup, stoppedEarly: stoppedEarlyInfo });
  write({ type: "site:done" });
}

// -----------------------------------------------------------------------------
// POST /api/audit/bulk
// -----------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req);

  // 1. Per-IP rate limit — a crawl is worth dozens of single audits in spend.
  const rate = checkBulkRateLimit(ip);
  if (!rate.allowed) {
    return jsonError(
      429,
      { error: "rate_limit", retryAfter: rate.retryAfterSec },
      { "Retry-After": String(rate.retryAfterSec) },
    );
  }

  // 2. Per-IP concurrency guard — only one crawl in flight per IP at a time.
  if (!acquireCrawlSlot(ip)) {
    return jsonError(429, {
      error: "concurrent_site_limit",
      message: "A site audit is already running for this connection — wait for it to finish before starting another.",
    });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    releaseCrawlSlot(ip);
    return jsonError(400, { error: "invalid_url", message: "Request body must be JSON." });
  }
  const parsedBody = bodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    releaseCrawlSlot(ip);
    return jsonError(400, { error: "invalid_url", message: "Request body must include a url." });
  }
  const submittedUrl = parsedBody.data.url;
  const targetUrl = parseAuditUrl(submittedUrl);
  if (!targetUrl) {
    releaseCrawlSlot(ip);
    return jsonError(400, { error: "invalid_url", message: "That doesn't look like a valid http(s) URL." });
  }

  let requestedPages: { url: string; source: "retry" }[] | undefined;
  if (parsedBody.data.pages) {
    const unique = new Map<string, { url: string; source: "retry" }>();
    for (const value of parsedBody.data.pages) {
      const pageUrl = parseAuditUrl(value);
      if (!pageUrl || pageUrl.origin !== targetUrl.origin) {
        releaseCrawlSlot(ip);
        return jsonError(400, {
          error: "invalid_url",
          message: "Retry pages must be valid URLs from the audited site.",
        });
      }
      unique.set(pageUrl.href, { url: pageUrl.href, source: "retry" });
    }
    requestedPages = [...unique.values()];
  }

  return createSseResponse(formatSiteAuditEvent, async (write, signal) => {
    try {
      await runSiteAudit(targetUrl.href, parsedBody.data.limit, requestedPages, write, signal);
    } finally {
      releaseCrawlSlot(ip);
    }
  });
}
