import { fetchArticle, safeFetchText } from "@/lib/import";
import type { ImagesSkillResult } from "./types";

/**
 * Image SEO checks — $0, deterministic (seo-images SKILL.md v2.2.4).
 * Regex-parses `<img>` tags (tolerant of attribute order); alt/dimensions/
 * lazy-loading/filename checks all come straight from the page markup.
 *
 * ponytail: safeFetchText has no HEAD support and doesn't surface a
 * Content-Length header — only {status, contentType, text}. Byte size is
 * approximated from the capped, UTF-8-decoded body it already reads
 * (imprecise for binary payloads, but "did the download hit the 300KB cap"
 * is exactly what "oversized" needs). Upgrade path: add a headers/HEAD seam
 * to safeFetchText if a caller ever needs exact byte counts.
 */

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const MAX_MISSING_ALT = 20;
const MAX_ISSUE_URLS = 20;
const MAX_OVERSIZED_SAMPLES = 10;
const OVERSIZED_THRESHOLD_BYTES = 300 * 1024;
const BELOW_FOLD_START_INDEX = 3;
const BAD_FILENAME_RE = /^(img|image|photo|dsc|screenshot|untitled)[-_]?\d*\.[a-z0-9]+$/i;

function extractAttr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i");
  const match = re.exec(tag);
  return match ? (match[1] ?? "") : null;
}

export interface ParsedImg {
  src: string | null;
  alt: string | null;
  hasWidth: boolean;
  hasHeight: boolean;
  loading: string | null;
}

/** Every `<img>` tag on the page, attribute-order tolerant. */
export function extractImgTags(html: string): ParsedImg[] {
  const out: ParsedImg[] = [];
  for (const tagMatch of html.matchAll(IMG_TAG_RE)) {
    const tag = tagMatch[0];
    out.push({
      src: extractAttr(tag, "src"),
      alt: extractAttr(tag, "alt"),
      hasWidth: extractAttr(tag, "width") !== null,
      hasHeight: extractAttr(tag, "height") !== null,
      loading: extractAttr(tag, "loading"),
    });
  }
  return out;
}

function resolveUrl(src: string, base: string): string {
  try {
    return new URL(src, base).toString();
  } catch {
    return src;
  }
}

/** Generic filenames ("IMG_1234.jpg", "screenshot.png") that tell users
 * nothing about the image content. */
export function isBadFilename(src: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(src, "http://placeholder.invalid/").pathname;
  } catch {
    pathname = src;
  }
  const filename = pathname.split("/").pop() ?? "";
  return filename === "" || BAD_FILENAME_RE.test(filename);
}

function boundUrls(urls: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

async function sampleImageBytes(src: string): Promise<number | null> {
  try {
    const res = await safeFetchText(src, { maxBytes: OVERSIZED_THRESHOLD_BYTES, timeoutMs: 5_000 });
    if (res.status < 200 || res.status >= 300) return null;
    return Buffer.byteLength(res.text, "utf-8");
  } catch {
    return null;
  }
}

export async function runImages(url: string): Promise<ImagesSkillResult> {
  const fetched = await fetchArticle(url);
  const imgs = extractImgTags(fetched.html).filter((img): img is ParsedImg & { src: string } => Boolean(img.src));
  const imageCount = imgs.length;

  const missingAlt = boundUrls(
    imgs.filter((img) => !img.alt || img.alt.trim() === "").map((img) => resolveUrl(img.src, fetched.finalUrl)),
    MAX_MISSING_ALT,
  );

  const missingDimensions = imgs.filter((img) => !img.hasWidth || !img.hasHeight);
  const noLazyBelowFold = imgs
    .slice(BELOW_FOLD_START_INDEX)
    .filter((img) => (img.loading ?? "").toLowerCase() !== "lazy");
  const badFilename = imgs.filter((img) => isBadFilename(img.src));

  const issues: ImagesSkillResult["issues"] = [];
  if (missingDimensions.length > 0) {
    issues.push({
      code: "missing-dimensions",
      count: missingDimensions.length,
      urls: boundUrls(missingDimensions.map((img) => resolveUrl(img.src, fetched.finalUrl)), MAX_ISSUE_URLS),
    });
  }
  if (noLazyBelowFold.length > 0) {
    issues.push({
      code: "no-lazy-below-fold",
      count: noLazyBelowFold.length,
      urls: boundUrls(noLazyBelowFold.map((img) => resolveUrl(img.src, fetched.finalUrl)), MAX_ISSUE_URLS),
    });
  }
  if (badFilename.length > 0) {
    issues.push({
      code: "bad-filename",
      count: badFilename.length,
      urls: boundUrls(badFilename.map((img) => resolveUrl(img.src, fetched.finalUrl)), MAX_ISSUE_URLS),
    });
  }

  const sampleSrcs = boundUrls(imgs.map((img) => resolveUrl(img.src, fetched.finalUrl)), MAX_OVERSIZED_SAMPLES);
  const oversized: ImagesSkillResult["oversized"] = [];
  for (const src of sampleSrcs) {
    const bytes = await sampleImageBytes(src);
    if (bytes !== null && bytes >= OVERSIZED_THRESHOLD_BYTES) oversized.push({ url: src, bytes });
  }

  return { imageCount, missingAlt, oversized, issues };
}
