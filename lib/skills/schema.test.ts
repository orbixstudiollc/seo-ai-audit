import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchArticle: vi.fn() }));
vi.mock("@/lib/import", () => ({ fetchArticle: mocks.fetchArticle }));

import {
  buildOrganizationJsonLd,
  extractJsonLdBlocks,
  flattenJsonLdNodes,
  isArticleLike,
  missingRecommendedTypes,
  runSchema,
  validateSchemaNode,
} from "./schema";

function article(html: string, finalUrl = "https://example.com/page", title = "Example Page"): void {
  mocks.fetchArticle.mockResolvedValue({ title, html, finalUrl });
}

beforeEach(() => {
  mocks.fetchArticle.mockReset();
});

describe("extractJsonLdBlocks", () => {
  it("extracts a single ld+json block regardless of attribute order", () => {
    const html = `<script id="x" type="application/ld+json">{"a":1}</script>`;
    expect(extractJsonLdBlocks(html)).toEqual(['{"a":1}']);
  });

  it("extracts multiple blocks", () => {
    const html = `<script type="application/ld+json">{"a":1}</script><p>x</p><script type="application/ld+json">{"b":2}</script>`;
    expect(extractJsonLdBlocks(html)).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("returns an empty array when no ld+json scripts exist", () => {
    expect(extractJsonLdBlocks("<html><body>hi</body></html>")).toEqual([]);
  });
});

describe("flattenJsonLdNodes", () => {
  it("flattens a @graph array", () => {
    const nodes = flattenJsonLdNodes({ "@graph": [{ "@type": "Organization" }, { "@type": "Article" }] });
    expect(nodes).toHaveLength(2);
  });

  it("wraps a single object", () => {
    expect(flattenJsonLdNodes({ "@type": "Organization" })).toEqual([{ "@type": "Organization" }]);
  });

  it("passes through a top-level array", () => {
    const nodes = flattenJsonLdNodes([{ "@type": "Organization" }]);
    expect(nodes).toEqual([{ "@type": "Organization" }]);
  });

  it("returns an empty array for non-object input", () => {
    expect(flattenJsonLdNodes("not json-ld")).toEqual([]);
  });
});

describe("validateSchemaNode", () => {
  it("marks Organization valid when name and url are present", () => {
    const result = validateSchemaNode({ "@type": "Organization", name: "Acme", url: "https://acme.com" });
    expect(result).toEqual({ type: "Organization", valid: true, errors: [], warnings: [] });
  });

  it("flags Organization missing name and url", () => {
    const result = validateSchemaNode({ "@type": "Organization" });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      'Organization is missing required property "name"',
      'Organization is missing required property "url"',
    ]);
  });

  it("flags Article missing headline/datePublished/author", () => {
    const result = validateSchemaNode({ "@type": "Article" });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  it("accepts an Article with a string author", () => {
    const result = validateSchemaNode({
      "@type": "Article",
      headline: "Title",
      datePublished: "2026-01-01",
      author: "Jane Doe",
    });
    expect(result.valid).toBe(true);
  });

  it("flags Product missing name/offers", () => {
    const result = validateSchemaNode({ "@type": "Product" });
    expect(result.errors).toEqual([
      'Product is missing required property "name"',
      'Product is missing required property "offers"',
    ]);
  });

  it("warns on deprecated HowTo without an error", () => {
    const result = validateSchemaNode({ "@type": "HowTo" });
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });

  it("warns on FAQPage's retired rich results", () => {
    const result = validateSchemaNode({ "@type": "FAQPage" });
    expect(result.valid).toBe(true);
    expect(result.warnings[0]).toMatch(/retired/);
  });

  it("passes through an unrecognized type with no errors or warnings", () => {
    const result = validateSchemaNode({ "@type": "WebSite" });
    expect(result).toEqual({ type: "WebSite", valid: true, errors: [], warnings: [] });
  });
});

describe("isArticleLike / missingRecommendedTypes", () => {
  it("detects an <article> element", () => {
    expect(isArticleLike("<html><article>text</article></html>")).toBe(true);
  });

  it("detects an og:type=article meta tag regardless of attribute order", () => {
    expect(isArticleLike(`<meta content="article" property="og:type">`)).toBe(true);
  });

  it("is false for an ordinary page", () => {
    expect(isArticleLike("<html><div>hi</div></html>")).toBe(false);
  });

  it("always recommends Organization when absent", () => {
    expect(missingRecommendedTypes([], "<html></html>")).toEqual(["Organization"]);
  });

  it("recommends Article only on article-like pages missing one", () => {
    expect(missingRecommendedTypes([{ type: "Organization", valid: true, errors: [], warnings: [] }], "<article>x</article>")).toEqual([
      "Article",
    ]);
  });

  it("does not recommend Article when a BlogPosting is already present", () => {
    const detected = [
      { type: "Organization", valid: true, errors: [], warnings: [] },
      { type: "BlogPosting", valid: true, errors: [], warnings: [] },
    ];
    expect(missingRecommendedTypes(detected, "<article>x</article>")).toEqual([]);
  });
});

describe("buildOrganizationJsonLd", () => {
  it("templates a minimal, valid Organization document", () => {
    const jsonld = buildOrganizationJsonLd("Acme", "https://acme.com");
    expect(JSON.parse(jsonld)).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Acme",
      url: "https://acme.com",
    });
  });
});

describe("runSchema", () => {
  it("detects a valid Organization and needs no generation", async () => {
    article(
      `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme","url":"https://acme.com"}</script>`,
    );
    const result = await runSchema("https://acme.com");
    expect(result.detected).toEqual([{ type: "Organization", valid: true, errors: [], warnings: [] }]);
    expect(result.missingRecommended).toEqual([]);
    expect(result.generated).toEqual([]);
  });

  it("reports a parse failure for malformed JSON-LD", async () => {
    article(`<script type="application/ld+json">{not valid json</script>`);
    const result = await runSchema("https://acme.com");
    expect(result.detected).toEqual([
      { type: "unknown", valid: false, errors: ["Invalid JSON in this ld+json block"], warnings: [] },
    ]);
  });

  it("flattens @graph and validates every node", async () => {
    article(
      `<script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Acme","url":"https://acme.com"},{"@type":"Product"}]}</script>`,
    );
    const result = await runSchema("https://acme.com");
    expect(result.detected).toHaveLength(2);
    expect(result.detected[1]?.valid).toBe(false);
  });

  it("generates a minimal Organization template when none is detected", async () => {
    article("<html><body>no schema here</body></html>", "https://acme.com/", "Acme Co");
    const result = await runSchema("https://acme.com/");
    expect(result.missingRecommended).toContain("Organization");
    expect(result.generated).toHaveLength(1);
    expect(result.generated[0]?.type).toBe("Organization");
    expect(JSON.parse(result.generated[0]?.jsonld ?? "{}")).toMatchObject({ name: "Acme Co", url: "https://acme.com" });
  });

  it("returns an empty page with no schema and no false Organization detection", async () => {
    article("");
    const result = await runSchema("https://acme.com");
    expect(result.detected).toEqual([]);
    expect(result.missingRecommended).toEqual(["Organization"]);
  });
});
