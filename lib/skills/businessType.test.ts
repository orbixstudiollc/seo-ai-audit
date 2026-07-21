import { describe, expect, it } from "vitest";
import { detectBusinessType, extractBusinessSignalInput } from "./businessType";

describe("detectBusinessType", () => {
  it("detects saas from pricing/features links + free trial copy", () => {
    const result = detectBusinessType({
      linkHrefs: ["/pricing", "/features", "/about"],
      plainText: "Start your free trial today.",
      jsonLdTypes: [],
    });
    expect(result.type).toBe("saas");
    expect(result.signals).toEqual(["path:/pricing", "path:/features", "text:free trial"]);
  });

  it("detects local from a phone number, street address, and 'serving' copy", () => {
    const result = detectBusinessType({
      linkHrefs: ["/contact"],
      plainText: "Call us at (555) 123-4567. Visit us at 123 Main Street. Proudly serving Austin.",
      jsonLdTypes: [],
    });
    expect(result.type).toBe("local");
    expect(result.signals).toEqual(["text:phone-number", "text:street-address", "text:serving"]);
  });

  it("detects ecommerce from a cart link, add-to-cart copy, and Product schema", () => {
    const result = detectBusinessType({
      linkHrefs: ["/cart", "/products/widget"],
      plainText: "Add to cart now for free shipping.",
      jsonLdTypes: ["Product"],
    });
    expect(result.type).toBe("ecommerce");
    expect(result.signals).toEqual(["path:/cart", "text:add to cart", "schema:Product"]);
  });

  it("detects publisher from a blog link, Article schema, and author pages", () => {
    const result = detectBusinessType({
      linkHrefs: ["/blog/post-1", "/author/jane-doe"],
      plainText: "An in-depth look at the news of the week.",
      jsonLdTypes: ["NewsArticle"],
    });
    expect(result.type).toBe("publisher");
    expect(result.signals).toEqual(["path:/blog", "schema:Article", "path:/author"]);
  });

  it("detects agency from case-studies and portfolio links", () => {
    const result = detectBusinessType({
      linkHrefs: ["/case-studies/acme", "/portfolio"],
      plainText: "See our work for clients across every industry.",
      jsonLdTypes: [],
    });
    expect(result.type).toBe("agency");
    expect(result.signals).toEqual(["path:/case-studies", "path:/portfolio"]);
  });

  it("falls back to general when no signal matches", () => {
    const result = detectBusinessType({ linkHrefs: ["/about", "/team"], plainText: "We build things.", jsonLdTypes: [] });
    expect(result).toEqual({ type: "general", signals: [] });
  });

  it("breaks a tie by table order (saas before local) when both score one signal", () => {
    const result = detectBusinessType({
      linkHrefs: ["/pricing"],
      plainText: "Proudly serving the whole region.",
      jsonLdTypes: [],
    });
    expect(result.type).toBe("saas");
    expect(result.signals).toEqual(["path:/pricing"]);
  });

  it("prefers the type with strictly more matched signals over an earlier tie-break candidate", () => {
    const result = detectBusinessType({
      linkHrefs: ["/pricing", "/cart"],
      plainText: "Add to cart for instant checkout.",
      jsonLdTypes: ["Product"],
    });
    // saas scores 1 (path:/pricing); ecommerce scores 3 -> ecommerce wins outright.
    expect(result.type).toBe("ecommerce");
  });
});

describe("extractBusinessSignalInput", () => {
  it("extracts hrefs and JSON-LD @type values from raw HTML", () => {
    const html = `
      <html><body>
        <a href="/pricing">Pricing</a>
        <a href="/blog/post">Blog</a>
        <script type="application/ld+json">{"@type":"Article","headline":"x"}</script>
      </body></html>
    `;
    const input = extractBusinessSignalInput(html, "Some plain text.");
    expect(input.linkHrefs).toEqual(["/pricing", "/blog/post"]);
    expect(input.jsonLdTypes).toEqual(["Article"]);
    expect(input.plainText).toBe("Some plain text.");
  });

  it("flattens an @graph array and array-valued @type", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":["Product","Thing"]}]}</script>`;
    const input = extractBusinessSignalInput(html, "");
    expect(input.jsonLdTypes).toEqual(["Product", "Thing"]);
  });

  it("skips unparseable JSON-LD blocks instead of throwing", () => {
    const html = `<script type="application/ld+json">not json</script>`;
    expect(() => extractBusinessSignalInput(html, "")).not.toThrow();
    expect(extractBusinessSignalInput(html, "").jsonLdTypes).toEqual([]);
  });
});
