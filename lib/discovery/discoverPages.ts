import { assertSafeUrl } from "@/lib/import";
import { fetchRobotsRules, type RobotsRules } from "./robots";
import { fetchSitemapUrls } from "./sitemap";
import { crawlSameOriginLinks } from "./linkCrawl";

/**
 * Turns one root URL into a bounded, same-origin list of pages to bulk-audit:
 * sitemap.xml (+ index) first, falling back to a same-origin HTML link crawl
 * (depth <= 2) when the site has no usable sitemap. Every fetch this makes —
 * robots.txt, sitemap.xml (+ children), and every crawled page — goes
 * through the SSRF-pinned safeFetchText, so discovery never enlarges the
 * SSRF surface beyond what fetchArticle.ts already guards for a single URL.
 */

export const DISCOVERY_DEFAULT_LIMIT = 30;
export const DISCOVERY_HARD_MAX = 50;
const CRAWL_MAX_DEPTH = 2;

export type DiscoveryMethod = "sitemap" | "crawl";

export interface DiscoveredPage {
  url: string;
  source: DiscoveryMethod;
}

export interface DiscoverPagesResult {
  rootUrl: string;
  pages: DiscoveredPage[];
  method: DiscoveryMethod;
  /** True when discovery found more allowed pages than `limit` and cut the list. */
  truncated: boolean;
}

export interface DiscoverPagesOptions {
  /** Defaults to DISCOVERY_DEFAULT_LIMIT; always clamped to DISCOVERY_HARD_MAX. */
  limit?: number;
  signal?: AbortSignal;
}

function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    url.hash = "";
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** Normalize, same-origin filter, robots filter, dedupe — the shared cleanup both discovery methods need. */
function cleanCandidates(urls: string[], origin: string, robots: RobotsRules): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const normalized = normalizeUrl(raw);
    if (!normalized) continue;
    let parsed: URL;
    try {
      parsed = new URL(normalized);
    } catch {
      continue;
    }
    if (parsed.origin !== origin) continue;
    if (!robots.isAllowed(parsed.pathname)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export async function discoverPages(
  rootUrlString: string,
  opts?: DiscoverPagesOptions,
): Promise<DiscoverPagesResult> {
  const limit = Math.min(opts?.limit ?? DISCOVERY_DEFAULT_LIMIT, DISCOVERY_HARD_MAX);

  // Same guard the single-page pipeline uses — a hostile root URL never gets this far.
  const { url: rootUrl } = await assertSafeUrl(rootUrlString);
  const origin = rootUrl.origin;
  const normalizedRoot = normalizeUrl(rootUrl.toString()) ?? rootUrl.toString();

  const robots = await fetchRobotsRules(origin, opts?.signal);

  const sitemapRaw = await fetchSitemapUrls(origin, opts?.signal).catch(() => [] as string[]);
  const sitemapPages = cleanCandidates([normalizedRoot, ...sitemapRaw], origin, robots);

  let method: DiscoveryMethod;
  let allPages: string[];

  if (sitemapPages.length > 1) {
    method = "sitemap";
    allPages = sitemapPages;
  } else {
    method = "crawl";
    const crawled = await crawlSameOriginLinks(rootUrl, {
      maxPages: limit,
      maxDepth: CRAWL_MAX_DEPTH,
      robots,
      signal: opts?.signal,
    }).catch(() => [normalizedRoot]);
    allPages = cleanCandidates(crawled, origin, robots);
    if (allPages.length === 0) allPages = [normalizedRoot];
  }

  const truncated = allPages.length > limit;
  const pages: DiscoveredPage[] = allPages.slice(0, limit).map((url) => ({ url, source: method }));

  return { rootUrl: normalizedRoot, pages, method, truncated };
}
