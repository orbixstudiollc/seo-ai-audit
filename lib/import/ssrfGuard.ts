import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ImportError } from "./errors";

/**
 * SSRF guard for the URL import feature (synthesis amendment #4 — hard CI
 * gate). Rejects URLs that could reach private/internal infrastructure:
 * non-http(s) schemes, embedded credentials, private/loopback/link-local/
 * reserved IP literals (v4 and v6), and hostnames that RESOLVE to any such
 * address. WHATWG URL parsing canonicalizes decimal/octal/hex IPv4 tricks
 * (http://2130706433/ -> 127.0.0.1) before we check, so literal obfuscation
 * is covered too.
 *
 * ponytail: validate-per-hop (this + validateRedirectHop after every
 * redirect) closes the redirect-rebinding vector; a fully pinned resolved-IP
 * dispatcher is the upgrade path if TOCTOU DNS rebinding within a single hop
 * ever matters for this threat model.
 */

const BLOCKED_MESSAGE =
  "This URL points to a blocked or private network address — paste the article text instead.";

// [network, prefixBits] — private + loopback + link-local (incl. the
// 169.254.169.254 cloud metadata endpoint) + reserved ranges.
const BLOCKED_IPV4_CIDRS: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, incl. 169.254.169.254 metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function ipv4ToInt(ip: string): number {
  const [a = 0, b = 0, c = 0, d = 0] = ip.split(".").map(Number);
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function isBlockedIpv4Int(value: number): boolean {
  return BLOCKED_IPV4_CIDRS.some(([network, bits]) => {
    const mask = (~0 << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (ipv4ToInt(network) & mask) >>> 0;
  });
}

/** Expand a valid IPv6 string (isIP === 6) into its 8 16-bit groups. */
function expandIpv6(ip: string): number[] {
  let s = ip.split("%")[0] ?? ip; // strip any zone id (fe80::1%eth0)
  // Convert a trailing dotted-quad (::ffff:127.0.0.1) into two hex groups.
  if (s.includes(".")) {
    const lastColon = s.lastIndexOf(":");
    const v4 = ipv4ToInt(s.slice(lastColon + 1));
    s = `${s.slice(0, lastColon + 1)}${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const hasCompression = s.includes("::");
  const [left = "", right = ""] = s.split("::");
  const leftParts = left === "" ? [] : left.split(":");
  const rightParts = right === "" ? [] : right.split(":");
  const zeros = hasCompression ? 8 - leftParts.length - rightParts.length : 0;
  return [...leftParts, ...Array<string>(zeros).fill("0"), ...rightParts].map((g) =>
    Number.parseInt(g, 16),
  );
}

function isBlockedIpv6(ip: string): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = expandIpv6(ip);
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    // :: (unspecified) and ::1 (loopback)
    if (g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true;
    // ::ffff:a.b.c.d IPv4-mapped — apply the IPv4 rules to the embedded address
    if (g5 === 0xffff) return isBlockedIpv4Int(((g6 << 16) | g7) >>> 0);
  }
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isBlockedIpv4Int(((g6 << 16) | g7) >>> 0); // 64:ff9b::/96 NAT64
  }
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // 2001:db8::/32 documentation
  return false;
}

function isBlockedIp(address: string, family: number): boolean {
  return family === 4 ? isBlockedIpv4Int(ipv4ToInt(address)) : isBlockedIpv6(address);
}

/**
 * Validate a URL for safe outbound fetching. Returns the parsed URL on
 * success; throws ImportError("blocked" | "fetch_failed") otherwise. For
 * hostnames, every DNS-resolved address is checked — a name resolving to
 * even one private address is rejected (DNS-rebinding via hostile records).
 */
export async function assertSafeUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ImportError(
      "fetch_failed",
      "That doesn't look like a valid URL — paste the article text instead.",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ImportError(
      "blocked",
      "Only http(s) URLs can be imported — paste the article text instead.",
    );
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new ImportError(
      "blocked",
      "URLs with embedded credentials are not allowed — paste the article text instead.",
    );
  }

  // URL keeps IPv6 literals bracketed ([::1]) — strip for isIP().
  const hostname =
    parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;

  const family = isIP(hostname);
  if (family !== 0) {
    if (isBlockedIp(hostname, family)) throw new ImportError("blocked", BLOCKED_MESSAGE);
    return parsed;
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new ImportError("blocked", BLOCKED_MESSAGE);
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new ImportError(
      "fetch_failed",
      "Could not resolve this URL's hostname — paste the article text instead.",
    );
  }
  if (addresses.length === 0) {
    throw new ImportError(
      "fetch_failed",
      "Could not resolve this URL's hostname — paste the article text instead.",
    );
  }
  for (const { address, family: addressFamily } of addresses) {
    if (isBlockedIp(address, addressFamily)) {
      throw new ImportError("blocked", BLOCKED_MESSAGE);
    }
  }

  return parsed;
}

/**
 * Re-validation applied to EVERY redirect target before it is followed —
 * a public URL 302-ing to http://169.254.169.254/ dies here.
 */
export function validateRedirectHop(url: string): Promise<URL> {
  return assertSafeUrl(url);
}
