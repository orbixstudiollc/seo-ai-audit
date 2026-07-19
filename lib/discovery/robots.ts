import { safeFetchText } from "@/lib/import";

/**
 * Minimal robots.txt policy: only the `User-agent: *` group's `Disallow`/
 * `Allow` prefix rules (longest-prefix-match wins, the de-facto standard).
 * No wildcard/`$` support, no crawl-delay. Good enough to genuinely respect
 * the file for an anonymous, best-effort discovery crawl without pulling in
 * a full robots-parser dependency for something this shaped.
 * ponytail: no wildcard/$ matching; upgrade if a real target site needs it.
 */
export interface RobotsRules {
  isAllowed(pathname: string): boolean;
}

export const ALLOW_ALL_ROBOTS: RobotsRules = { isAllowed: () => true };

function longestMatch(prefixes: string[], pathname: string): number {
  let best = -1;
  for (const prefix of prefixes) {
    if (prefix !== "" && pathname.startsWith(prefix) && prefix.length > best) best = prefix.length;
  }
  return best;
}

/** Parses robots.txt text into a same-shape RobotsRules. Exported for direct unit testing. */
export function parseRobots(text: string): RobotsRules {
  const disallow: string[] = [];
  const allow: string[] = [];
  let inWildcardGroup = false;
  let sawUserAgentLine = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const field = line.slice(0, colonIndex).trim().toLowerCase();
    const value = line.slice(colonIndex + 1).trim();

    if (field === "user-agent") {
      sawUserAgentLine = true;
      inWildcardGroup = value === "*";
      continue;
    }
    if (!inWildcardGroup) continue;
    if (field === "disallow" && value) disallow.push(value);
    if (field === "allow" && value) allow.push(value);
  }

  if (!sawUserAgentLine) return ALLOW_ALL_ROBOTS;

  return {
    isAllowed(pathname: string): boolean {
      const disallowDepth = longestMatch(disallow, pathname);
      if (disallowDepth === -1) return true;
      return longestMatch(allow, pathname) >= disallowDepth;
    },
  };
}

/**
 * Fetches `${origin}/robots.txt` through the SSRF-guarded safeFetchText.
 * Fails OPEN (allow everything) on any error, timeout, or non-2xx — a
 * missing robots.txt is the overwhelmingly common, entirely legitimate case,
 * not a reason to abandon discovery.
 */
export async function fetchRobotsRules(origin: string, signal?: AbortSignal): Promise<RobotsRules> {
  try {
    const result = await safeFetchText(new URL("/robots.txt", origin).toString(), {
      signal,
      maxBytes: 200_000,
      timeoutMs: 5_000,
    });
    if (result.status < 200 || result.status >= 300) return ALLOW_ALL_ROBOTS;
    return parseRobots(result.text);
  } catch {
    return ALLOW_ALL_ROBOTS;
  }
}
