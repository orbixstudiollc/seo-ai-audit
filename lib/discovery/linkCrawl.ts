import { parseHTML } from "linkedom";
import { safeFetchText } from "@/lib/import";
import { ALLOW_ALL_ROBOTS, type RobotsRules } from "./robots";

/**
 * Same-origin, robots-respecting, breadth-first HTML link crawl — the
 * fallback discovery method when a site has no sitemap.xml. Bounded on two
 * axes so a huge or adversarial site can never turn one audit request into
 * an unbounded number of outbound fetches: `maxDepth` (link hops from the
 * root) and `maxPages` (stops enqueueing new fetches once the discovered
 * list is full).
 */

export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  robots?: RobotsRules;
  signal?: AbortSignal;
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "/";
  }
}

function extractSameOriginLinks(html: string, baseUrl: string, origin: string): string[] {
  const { document } = parseHTML(html);
  const links: string[] = [];
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.origin !== origin) continue;
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
      resolved.hash = "";
      links.push(resolved.toString());
    } catch {
      continue;
    }
  }
  return links;
}

export async function crawlSameOriginLinks(rootUrl: URL, opts: CrawlOptions): Promise<string[]> {
  const robots = opts.robots ?? ALLOW_ALL_ROBOTS;
  const origin = rootUrl.origin;
  const rootString = rootUrl.toString();
  const visited = new Set<string>([rootString]);
  const discovered: string[] = [];
  const frontier: Array<{ url: string; depth: number }> = [{ url: rootString, depth: 0 }];

  while (frontier.length > 0 && discovered.length < opts.maxPages) {
    const next = frontier.shift();
    if (!next) break;
    const { url, depth } = next;
    if (!robots.isAllowed(safePathname(url))) continue;

    discovered.push(url);
    if (discovered.length >= opts.maxPages || depth >= opts.maxDepth) continue;

    let html: string;
    try {
      const result = await safeFetchText(url, { signal: opts.signal, maxBytes: 2 * 1024 * 1024, timeoutMs: 8_000 });
      if (result.status < 200 || result.status >= 300 || !result.contentType.includes("html")) continue;
      html = result.text;
    } catch {
      continue;
    }

    for (const link of extractSameOriginLinks(html, url, origin)) {
      if (visited.has(link)) continue;
      visited.add(link);
      frontier.push({ url: link, depth: depth + 1 });
    }
  }

  return discovered;
}
