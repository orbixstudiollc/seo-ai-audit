import { safeFetchText } from "@/lib/import";

/**
 * sitemap.xml (+ one level of sitemap-index nesting) reader. Extracts
 * `<loc>` entries with a regex rather than a real XML parser — sitemap.xml
 * is simple enough flat markup that this is reliable in practice and avoids
 * pulling in a new XML dependency for a handful of <loc> tags.
 * ponytail: regex <loc> extraction + one index-nesting level, capped
 * children; a huge/hostile sitemap index degrades to "some URLs missing",
 * never an unbounded fetch. Upgrade to a real XML parser if a target site's
 * sitemap turns out to need CDATA/entity edge cases this doesn't cover.
 */

const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
const SITEMAP_INDEX_RE = /<sitemapindex[\s>]/i;
const MAX_INDEX_CHILDREN = 5;
const MAX_SITEMAP_BYTES = 5 * 1024 * 1024;

interface LocEntries {
  isIndex: boolean;
  locs: string[];
}

async function fetchLocEntries(url: string, signal?: AbortSignal): Promise<LocEntries> {
  const result = await safeFetchText(url, { signal, maxBytes: MAX_SITEMAP_BYTES, timeoutMs: 8_000 });
  if (result.status < 200 || result.status >= 300) return { isIndex: false, locs: [] };
  const locs = [...result.text.matchAll(LOC_RE)].map((m) => m[1] ?? "").filter(Boolean);
  return { isIndex: SITEMAP_INDEX_RE.test(result.text), locs };
}

/**
 * Fetches `${origin}/sitemap.xml`; if it's a sitemap INDEX, follows up to
 * MAX_INDEX_CHILDREN child sitemaps and merges their <loc> entries. Returns
 * an empty array (never throws) on any fetch/parse failure — a missing
 * sitemap is the expected, common case that triggers the link-crawl fallback.
 */
export async function fetchSitemapUrls(origin: string, signal?: AbortSignal): Promise<string[]> {
  let root: LocEntries;
  try {
    root = await fetchLocEntries(new URL("/sitemap.xml", origin).toString(), signal);
  } catch {
    return [];
  }
  if (!root.isIndex) return root.locs;

  const urls: string[] = [];
  for (const child of root.locs.slice(0, MAX_INDEX_CHILDREN)) {
    try {
      const childEntries = await fetchLocEntries(child, signal);
      urls.push(...childEntries.locs);
    } catch {
      // best-effort: skip a broken child sitemap, keep the rest
    }
  }
  return urls;
}
