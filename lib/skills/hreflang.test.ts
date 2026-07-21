import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchArticle: vi.fn() }));
vi.mock("@/lib/import", () => ({ fetchArticle: mocks.fetchArticle }));

import { extractCanonical, extractHreflangTags, isValidHreflangCode, runHreflang } from "./hreflang";

function page(html: string, finalUrl: string): { title: string; html: string; finalUrl: string } {
  return { title: "", html, finalUrl };
}

beforeEach(() => {
  mocks.fetchArticle.mockReset();
});

describe("isValidHreflangCode", () => {
  it.each(["en", "en-US", "en-GB", "fr", "pt-BR", "zh-Hans", "zh-Hans-US", "x-default", "X-DEFAULT"])(
    "accepts %s",
    (code) => {
      expect(isValidHreflangCode(code)).toBe(true);
    },
  );

  it.each(["eng", "jp", "en-uk", "en-EU", "be-BE-extra", "123"])("rejects %s", (code) => {
    expect(isValidHreflangCode(code)).toBe(false);
  });
});

describe("extractHreflangTags / extractCanonical", () => {
  it("extracts alternate hreflang tags regardless of attribute order", () => {
    const html = `<link href="https://example.com/fr" hreflang="fr" rel="alternate">`;
    expect(extractHreflangTags(html)).toEqual([{ hreflang: "fr", href: "https://example.com/fr" }]);
  });

  it("ignores non-alternate link tags", () => {
    const html = `<link rel="stylesheet" href="/a.css">`;
    expect(extractHreflangTags(html)).toEqual([]);
  });

  it("extracts the canonical link", () => {
    const html = `<link rel="canonical" href="https://example.com/page">`;
    expect(extractCanonical(html)).toBe("https://example.com/page");
  });

  it("returns null when no canonical is present", () => {
    expect(extractCanonical("<html></html>")).toBeNull();
  });
});

describe("runHreflang", () => {
  const url = "https://example.com/page";

  it("passes every check for a well-formed, reciprocal, self-referencing set", async () => {
    const frHtml = `
      <link rel="alternate" hreflang="en" href="https://example.com/page">
      <link rel="alternate" hreflang="fr" href="https://example.com/fr/page">
    `;
    mocks.fetchArticle.mockImplementation(async (target: string) => {
      if (target === url) {
        return page(
          `<link rel="canonical" href="https://example.com/page">
           <link rel="alternate" hreflang="en" href="https://example.com/page">
           <link rel="alternate" hreflang="fr" href="https://example.com/fr/page">
           <link rel="alternate" hreflang="x-default" href="https://example.com/page">`,
          url,
        );
      }
      return page(frHtml, target);
    });

    const result = await runHreflang(url);
    const byCode = Object.fromEntries(result.checks.map((c) => [c.code, c]));
    expect(byCode["valid-codes"]?.pass).toBe(true);
    expect(byCode["self-reference"]?.pass).toBe(true);
    expect(byCode["x-default"]?.pass).toBe(true);
    expect(byCode["absolute-urls"]?.pass).toBe(true);
    expect(byCode["protocol-consistent"]?.pass).toBe(true);
    expect(byCode["canonical-alignment"]?.pass).toBe(true);
    expect(byCode.reciprocal?.pass).toBe(true);
  });

  it("reports 'not checked' reciprocal when there are no other alternates", async () => {
    mocks.fetchArticle.mockResolvedValue(
      page(`<link rel="alternate" hreflang="en" href="${url}">`, url),
    );
    const result = await runHreflang(url);
    const reciprocal = result.checks.find((c) => c.code === "reciprocal");
    expect(reciprocal).toEqual({ code: "reciprocal", pass: true, detail: "not checked", urls: [] });
  });

  it("flags an invalid language code", async () => {
    mocks.fetchArticle.mockResolvedValue(
      page(`<link rel="alternate" hreflang="eng" href="https://example.com/other">`, url),
    );
    const result = await runHreflang(url);
    const check = result.checks.find((c) => c.code === "valid-codes");
    expect(check?.pass).toBe(false);
    expect(check?.urls).toEqual(["https://example.com/other"]);
  });

  it("flags a missing self-referencing tag", async () => {
    mocks.fetchArticle.mockResolvedValue(
      page(`<link rel="alternate" hreflang="fr" href="https://example.com/fr">`, url),
    );
    const result = await runHreflang(url);
    expect(result.checks.find((c) => c.code === "self-reference")?.pass).toBe(false);
  });

  it("flags a relative hreflang href as not absolute", async () => {
    mocks.fetchArticle.mockResolvedValue(page(`<link rel="alternate" hreflang="fr" href="/fr/page">`, url));
    const result = await runHreflang(url);
    const check = result.checks.find((c) => c.code === "absolute-urls");
    expect(check?.pass).toBe(false);
    expect(check?.urls).toEqual(["/fr/page"]);
  });

  it("flags mixed http/https protocols", async () => {
    mocks.fetchArticle.mockResolvedValue(
      page(
        `<link rel="alternate" hreflang="en" href="https://example.com/page">
         <link rel="alternate" hreflang="fr" href="http://example.com/fr">`,
        url,
      ),
    );
    const result = await runHreflang(url);
    expect(result.checks.find((c) => c.code === "protocol-consistent")?.pass).toBe(false);
  });

  it("flags a self-ref/canonical mismatch", async () => {
    mocks.fetchArticle.mockResolvedValue(
      page(
        `<link rel="canonical" href="https://example.com/canonical-page">
         <link rel="alternate" hreflang="en" href="https://example.com/page">`,
        url,
      ),
    );
    const result = await runHreflang(url);
    const check = result.checks.find((c) => c.code === "canonical-alignment");
    expect(check?.pass).toBe(false);
    expect(check?.urls).toEqual(["https://example.com/canonical-page"]);
  });

  it("flags a non-reciprocal alternate", async () => {
    mocks.fetchArticle.mockImplementation(async (target: string) => {
      if (target === url) {
        return page(
          `<link rel="alternate" hreflang="en" href="${url}">
           <link rel="alternate" hreflang="fr" href="https://example.com/fr">`,
          url,
        );
      }
      // The fr page doesn't link back to the English page.
      return page(`<link rel="alternate" hreflang="fr" href="https://example.com/fr">`, target);
    });
    const result = await runHreflang(url);
    const reciprocal = result.checks.find((c) => c.code === "reciprocal");
    expect(reciprocal?.pass).toBe(false);
    expect(reciprocal?.urls).toEqual(["https://example.com/fr"]);
  });

  it("treats an unreachable alternate as a reciprocal failure", async () => {
    mocks.fetchArticle.mockImplementation(async (target: string) => {
      if (target === url) {
        return page(
          `<link rel="alternate" hreflang="en" href="${url}">
           <link rel="alternate" hreflang="fr" href="https://example.com/fr">`,
          url,
        );
      }
      throw new Error("network down");
    });
    const result = await runHreflang(url);
    const reciprocal = result.checks.find((c) => c.code === "reciprocal");
    expect(reciprocal?.pass).toBe(false);
  });
});
