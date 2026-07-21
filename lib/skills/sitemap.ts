import { safeFetchText } from "@/lib/import";
import type { SitemapSkillResult } from "./types";

/**
 * Sitemap validation — $0, deterministic (seo-sitemap SKILL.md v2.2.4).
 *
 * ponytail: lib/discovery/sitemap.ts's fetchSitemapUrls(origin) only ever
 * fetches `${origin}/sitemap.xml` — it can't take an explicit
 * robots-declared URL, which this skill needs to prefer. Rather than change
 * that shared discovery helper (out of this module's ownership and used by
 * the anonymous crawl path), this mirrors its small regex-based <loc>/index
 * parsing locally against an arbitrary URL. Upgrade to a real XML parser
 * together if a target sitemap ever needs CDATA/entity edge cases.
 */

const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
const SITEMAP_INDEX_RE = /<sitemapindex[\s>]/i;
const SITEMAP_DECL_RE = /^\s*sitemap\s*:\s*(\S+)/gim;
const MAX_INDEX_CHILDREN = 5;
const MAX_SITEMAP_BYTES = 5 * 1024 * 1024;
const MAX_URLS = 50_000; // rubric hard cap (single-file sitemap)

/** Every `Sitemap:` declaration in a robots.txt body, in file order. */
export function parseSitemapDeclarations(robotsText: string): string[] {
  return [...robotsText.matchAll(SITEMAP_DECL_RE)].map((m) => m[1] ?? "").filter(Boolean);
}

interface LocEntries {
  isIndex: boolean;
  locs: string[];
}

export function parseLocEntries(xmlText: string): LocEntries {
  const locs = [...xmlText.matchAll(LOC_RE)].map((m) => m[1] ?? "").filter(Boolean);
  return { isIndex: SITEMAP_INDEX_RE.test(xmlText), locs };
}

async function fetchLocEntriesAt(url: string): Promise<LocEntries | null> {
  try {
    const res = await safeFetchText(url, { maxBytes: MAX_SITEMAP_BYTES, timeoutMs: 8_000 });
    if (res.status < 200 || res.status >= 300) return null;
    return parseLocEntries(res.text);
  } catch {
    return null;
  }
}

function sameOrigin(loc: string, origin: string): boolean {
  try {
    return new URL(loc).origin === origin;
  } catch {
    return false;
  }
}

function hasMixedProtocols(locs: string[]): boolean {
  const protocols = new Set<string>();
  for (const loc of locs) {
    try {
      protocols.add(new URL(loc).protocol);
    } catch {
      // unparsable entries don't count toward protocol consistency
    }
  }
  return protocols.size > 1;
}

export async function runSitemap(url: string): Promise<SitemapSkillResult> {
  const origin = new URL(url).origin;

  let declared: string[] = [];
  try {
    const robotsRes = await safeFetchText(new URL("/robots.txt", origin).toString(), {
      maxBytes: 200_000,
      timeoutMs: 5_000,
    });
    if (robotsRes.status >= 200 && robotsRes.status < 300) declared = parseSitemapDeclarations(robotsRes.text);
  } catch {
    // robots.txt is best-effort; declaredInRobots stays false on failure
  }
  const declaredInRobots = declared.length > 0;
  const candidateUrl = declared[0] ?? new URL("/sitemap.xml", origin).toString();

  const issues: SitemapSkillResult["issues"] = [];
  const root = await fetchLocEntriesAt(candidateUrl);

  if (root === null) {
    issues.push({ code: "missing-sitemap", severity: "error", detail: `No sitemap found at ${candidateUrl}` });
    if (!declaredInRobots) {
      issues.push({ code: "not-declared-in-robots", severity: "warning", detail: "robots.txt does not declare a Sitemap:" });
    }
    return { sitemapUrl: null, declaredInRobots, urlCount: 0, sameOriginCount: 0, issues };
  }

  let locs = root.locs;
  if (root.isIndex) {
    const merged: string[] = [];
    for (const child of root.locs.slice(0, MAX_INDEX_CHILDREN)) {
      const childEntries = await fetchLocEntriesAt(child);
      if (childEntries) merged.push(...childEntries.locs);
    }
    locs = merged;
  }

  const urlCount = locs.length;
  const sameOriginCount = locs.filter((loc) => sameOrigin(loc, origin)).length;

  if (!declaredInRobots) {
    issues.push({ code: "not-declared-in-robots", severity: "warning", detail: "robots.txt does not declare a Sitemap:" });
  }
  if (urlCount > MAX_URLS) {
    issues.push({ code: "too-many-urls", severity: "error", detail: `${urlCount} URLs exceeds the 50,000 per-file limit` });
  }
  if (hasMixedProtocols(locs)) {
    issues.push({ code: "mixed-protocol", severity: "warning", detail: "Sitemap contains both http:// and https:// URLs" });
  }
  if (urlCount > 0 && sameOriginCount / urlCount < 0.5) {
    issues.push({
      code: "low-same-origin",
      severity: "warning",
      detail: `Only ${sameOriginCount} of ${urlCount} URLs share this site's origin`,
    });
  }

  return { sitemapUrl: candidateUrl, declaredInRobots, urlCount, sameOriginCount, issues };
}
