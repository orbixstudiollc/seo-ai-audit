import { fetchArticle } from "@/lib/import";
import type { SchemaSkillResult } from "./types";

/**
 * Schema (JSON-LD) detect + validate + generate — $0, deterministic
 * (seo-schema SKILL.md v2.2.4). Regex-extracts every
 * `<script type="application/ld+json">` block (tolerant of attribute
 * order), validates the handful of types the rubric covers, and templates a
 * minimal Organization JSON-LD when one is missing.
 */

const JSONLD_SCRIPT_RE =
  /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const ARTICLE_TAG_RE = /<article[\s>]/i;
const META_TAG_RE = /<meta\b[^>]*>/gi;
const OG_TYPE_PROPERTY_RE = /property\s*=\s*["']og:type["']/i;
const CONTENT_ARTICLE_RE = /content\s*=\s*["']article["']/i;

/** Extracts the raw text of every JSON-LD `<script>` block on the page. */
export function extractJsonLdBlocks(html: string): string[] {
  return [...html.matchAll(JSONLD_SCRIPT_RE)].map((m) => m[1] ?? "");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Flattens a parsed JSON-LD document (single node, array, or `@graph`) into
 * its constituent nodes. */
export function flattenJsonLdNodes(parsed: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(parsed)) return parsed.filter(isPlainObject);
  if (isPlainObject(parsed)) {
    const graph = parsed["@graph"];
    if (Array.isArray(graph)) return graph.filter(isPlainObject);
    return [parsed];
  }
  return [];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function hasAuthor(value: unknown): boolean {
  if (isNonEmptyString(value)) return true;
  return isPlainObject(value) && isNonEmptyString(value.name);
}

function typeNameOf(node: Record<string, unknown>): string {
  const raw = node["@type"];
  if (Array.isArray(raw)) return isNonEmptyString(raw[0]) ? raw[0] : "Unknown";
  return isNonEmptyString(raw) ? raw : "Unknown";
}

export interface DetectedSchema {
  type: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const ARTICLE_LIKE_TYPES = new Set(["Article", "BlogPosting", "NewsArticle"]);

/** Validates one JSON-LD node against the rubric tables (seo-schema SKILL.md). */
export function validateSchemaNode(node: Record<string, unknown>): DetectedSchema {
  const type = typeNameOf(node);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (type === "Organization") {
    if (!isNonEmptyString(node.name)) errors.push('Organization is missing required property "name"');
    if (!isNonEmptyString(node.url)) errors.push('Organization is missing required property "url"');
  } else if (ARTICLE_LIKE_TYPES.has(type)) {
    if (!isNonEmptyString(node.headline)) errors.push(`${type} is missing required property "headline"`);
    if (!isNonEmptyString(node.datePublished)) errors.push(`${type} is missing required property "datePublished"`);
    if (!hasAuthor(node.author)) errors.push(`${type} is missing required property "author"`);
  } else if (type === "Product") {
    if (!isNonEmptyString(node.name)) errors.push('Product is missing required property "name"');
    if (node.offers === undefined || node.offers === null) errors.push('Product is missing required property "offers"');
  } else if (type === "HowTo") {
    warnings.push("HowTo rich results were removed (Sept 2023) — this markup no longer earns a rich result");
  } else if (type === "FAQPage") {
    warnings.push(
      "FAQPage rich results were retired for all sites (May 2026) — keep only for genuine Q&A content (consider QAPage)",
    );
  }

  return { type, valid: errors.length === 0, errors, warnings };
}

/** Heuristic: does this page look like an article (so Article schema is
 * "recommended" alongside the always-recommended Organization)? */
export function isArticleLike(html: string): boolean {
  if (ARTICLE_TAG_RE.test(html)) return true;
  return [...html.matchAll(META_TAG_RE)].some(
    (m) => OG_TYPE_PROPERTY_RE.test(m[0]) && CONTENT_ARTICLE_RE.test(m[0]),
  );
}

export function missingRecommendedTypes(detected: DetectedSchema[], html: string): string[] {
  const seen = new Set(detected.map((d) => d.type));
  const missing: string[] = [];
  if (!seen.has("Organization")) missing.push("Organization");
  if (isArticleLike(html) && ![...ARTICLE_LIKE_TYPES].some((t) => seen.has(t))) missing.push("Article");
  return missing;
}

/** Minimal, truthful Organization JSON-LD templated from the page itself —
 * generation is always code, never an LLM call (house rule, see jsonld.ts). */
export function buildOrganizationJsonLd(name: string, url: string): string {
  const doc = { "@context": "https://schema.org", "@type": "Organization", name, url };
  return JSON.stringify(doc, null, 2);
}

export async function runSchema(url: string): Promise<SchemaSkillResult> {
  const fetched = await fetchArticle(url);
  const detected: DetectedSchema[] = [];

  for (const raw of extractJsonLdBlocks(fetched.html)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      detected.push({ type: "unknown", valid: false, errors: ["Invalid JSON in this ld+json block"], warnings: [] });
      continue;
    }
    for (const node of flattenJsonLdNodes(parsed)) detected.push(validateSchemaNode(node));
  }

  const missingRecommended = missingRecommendedTypes(detected, fetched.html);
  const generated: SchemaSkillResult["generated"] = [];
  if (missingRecommended.includes("Organization")) {
    const origin = new URL(fetched.finalUrl).origin;
    const name = fetched.title || new URL(fetched.finalUrl).hostname;
    generated.push({ type: "Organization", jsonld: buildOrganizationJsonLd(name, origin) });
  }

  return { detected, missingRecommended, generated };
}
