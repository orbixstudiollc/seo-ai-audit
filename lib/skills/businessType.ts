import { extractJsonLdBlocks, flattenJsonLdNodes } from "./schema";

/**
 * SK3-BE — business-type detection for the agent orchestrator's plan step
 * (DATA-CONTRACT §9). Signal table ported from claude-seo's seo/SKILL.md
 * "Industry Detection" section. Pure and deterministic: same input always
 * yields the same detection, so it's unit-testable without a network call.
 */

export type BusinessType = "saas" | "local" | "ecommerce" | "publisher" | "agency" | "general";

export interface BusinessSignalInput {
  linkHrefs: string[];
  plainText: string;
  jsonLdTypes: string[];
}

export interface BusinessTypeDetection {
  type: BusinessType;
  signals: string[];
}

interface SignalContext {
  hrefs: string[];
  text: string;
  types: Set<string>;
}

interface SignalCheck {
  label: string;
  test: (ctx: SignalContext) => boolean;
}

function hrefIncludes(ctx: SignalContext, needle: string): boolean {
  return ctx.hrefs.some((href) => href.includes(needle));
}

function textIncludes(ctx: SignalContext, needle: string): boolean {
  return ctx.text.includes(needle);
}

function typeIncludes(ctx: SignalContext, name: string): boolean {
  return ctx.types.has(name.toLowerCase());
}

// Phone number: (555) 123-4567, 555-123-4567, 555.123.4567, etc.
const PHONE_RE = /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/;
// Street address: "123 Main Street", "45 Oak Ave", "1200 N Elm Blvd Suite 100".
const ADDRESS_RE =
  /\d{1,5}\s+[a-z0-9.'\s]{2,40}\b(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|suite|ste)\b/;
const SERVING_RE = /\bserving\s+[a-z]{2,}/;

const ARTICLE_LIKE_TYPES = ["article", "blogposting", "newsarticle"];

/**
 * Ordered by tie-break priority: the type declared earliest wins when two
 * types score the same number of matched signals.
 */
const BUSINESS_TYPE_SIGNALS: Array<{ type: BusinessType; checks: SignalCheck[] }> = [
  {
    type: "saas",
    checks: [
      { label: "path:/pricing", test: (ctx) => hrefIncludes(ctx, "/pricing") },
      { label: "path:/features", test: (ctx) => hrefIncludes(ctx, "/features") },
      { label: "text:free trial", test: (ctx) => textIncludes(ctx, "free trial") },
    ],
  },
  {
    type: "local",
    checks: [
      { label: "text:phone-number", test: (ctx) => PHONE_RE.test(ctx.text) },
      { label: "text:street-address", test: (ctx) => ADDRESS_RE.test(ctx.text) },
      { label: "text:serving", test: (ctx) => SERVING_RE.test(ctx.text) },
    ],
  },
  {
    type: "ecommerce",
    checks: [
      { label: "path:/cart", test: (ctx) => hrefIncludes(ctx, "/cart") },
      { label: "text:add to cart", test: (ctx) => textIncludes(ctx, "add to cart") },
      { label: "schema:Product", test: (ctx) => typeIncludes(ctx, "Product") },
    ],
  },
  {
    type: "publisher",
    checks: [
      { label: "path:/blog", test: (ctx) => hrefIncludes(ctx, "/blog") },
      { label: "schema:Article", test: (ctx) => ARTICLE_LIKE_TYPES.some((t) => typeIncludes(ctx, t)) },
      { label: "path:/author", test: (ctx) => hrefIncludes(ctx, "/author") },
    ],
  },
  {
    type: "agency",
    checks: [
      { label: "path:/case-studies", test: (ctx) => hrefIncludes(ctx, "/case-studies") },
      { label: "path:/portfolio", test: (ctx) => hrefIncludes(ctx, "/portfolio") },
    ],
  },
];

/** Scores every business type's signal table against the page and returns the
 * top match. Ties go to whichever type appears earliest in the table above;
 * zero matches anywhere returns "general". */
export function detectBusinessType(parsed: BusinessSignalInput): BusinessTypeDetection {
  const ctx: SignalContext = {
    hrefs: parsed.linkHrefs.map((h) => h.toLowerCase()),
    text: parsed.plainText.toLowerCase(),
    types: new Set(parsed.jsonLdTypes.map((t) => t.toLowerCase())),
  };

  let best: BusinessTypeDetection | null = null;
  for (const entry of BUSINESS_TYPE_SIGNALS) {
    const signals = entry.checks.filter((check) => check.test(ctx)).map((check) => check.label);
    if (best === null || signals.length > best.signals.length) {
      best = { type: entry.type, signals };
    }
  }

  if (best === null || best.signals.length === 0) return { type: "general", signals: [] };
  return best;
}

// --- html -> BusinessSignalInput glue (route-facing) ------------------------

const HREF_RE = /<a\b[^>]*\shref\s*=\s*["']([^"']*)["'][^>]*>/gi;

/** Every `<a href>` target on the page, in document order. */
function extractHrefs(html: string): string[] {
  return [...html.matchAll(HREF_RE)].map((m) => m[1] ?? "").filter(Boolean);
}

/** Every JSON-LD `@type` value on the page (reuses schema.ts's block/node
 * extraction rather than re-parsing ld+json here). */
function extractJsonLdTypeNames(html: string): string[] {
  const types: string[] = [];
  for (const raw of extractJsonLdBlocks(html)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const node of flattenJsonLdNodes(parsed)) {
      const value = node["@type"];
      if (typeof value === "string") types.push(value);
      else if (Array.isArray(value)) {
        for (const item of value) if (typeof item === "string") types.push(item);
      }
    }
  }
  return types;
}

/** Builds the pure `detectBusinessType` input from a fetched page's raw HTML
 * + its already-computed plainText (so callers don't re-run the markdown
 * pipeline just for this). */
export function extractBusinessSignalInput(html: string, plainText: string): BusinessSignalInput {
  return { linkHrefs: extractHrefs(html), plainText, jsonLdTypes: extractJsonLdTypeNames(html) };
}
