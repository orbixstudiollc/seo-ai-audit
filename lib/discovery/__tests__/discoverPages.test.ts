import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/import", () => ({
  assertSafeUrl: vi.fn(async (url: string) => ({ url: new URL(url), dispatcher: {} })),
  safeFetchText: vi.fn(),
}));

import { safeFetchText } from "@/lib/import";
import { discoverPages, DISCOVERY_HARD_MAX } from "../discoverPages";

const safeFetchTextMock = safeFetchText as unknown as Mock;

function res(text: string, status = 200, contentType = "text/html") {
  return { finalUrl: "", status, contentType, text };
}

const NOT_FOUND = res("", 404);

beforeEach(() => {
  safeFetchTextMock.mockReset();
});

describe("discoverPages — sitemap path", () => {
  it("uses the sitemap when it lists pages beyond the root, same-origin only, deduped", async () => {
    safeFetchTextMock.mockImplementation(async (url: string) => {
      if (url === "https://example.com/robots.txt") return NOT_FOUND;
      if (url === "https://example.com/sitemap.xml") {
        return res(
          `<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/a</loc></url><url><loc>https://other.com/x</loc></url></urlset>`,
          200,
          "application/xml",
        );
      }
      return NOT_FOUND;
    });

    const result = await discoverPages("https://example.com/");
    expect(result.method).toBe("sitemap");
    expect(result.pages.map((p) => p.url).sort()).toEqual([
      "https://example.com/",
      "https://example.com/a",
    ]);
    expect(result.truncated).toBe(false);
  });

  it("respects robots.txt disallow rules when filtering sitemap URLs", async () => {
    safeFetchTextMock.mockImplementation(async (url: string) => {
      if (url === "https://example.com/robots.txt") {
        return res("User-agent: *\nDisallow: /private\n", 200, "text/plain");
      }
      if (url === "https://example.com/sitemap.xml") {
        return res(
          `<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/private/b</loc></url></urlset>`,
          200,
          "application/xml",
        );
      }
      return NOT_FOUND;
    });

    const result = await discoverPages("https://example.com/");
    const urls = result.pages.map((p) => p.url);
    expect(urls).toContain("https://example.com/a");
    expect(urls).not.toContain("https://example.com/private/b");
  });

  it("caps the discovered list at `limit` and reports truncated", async () => {
    safeFetchTextMock.mockImplementation(async (url: string) => {
      if (url === "https://example.com/robots.txt") return NOT_FOUND;
      if (url === "https://example.com/sitemap.xml") {
        const urls = Array.from({ length: 40 }, (_, i) => `<url><loc>https://example.com/p${i}</loc></url>`).join("");
        return res(`<urlset>${urls}</urlset>`, 200, "application/xml");
      }
      return NOT_FOUND;
    });

    const result = await discoverPages("https://example.com/", { limit: 10 });
    expect(result.pages).toHaveLength(10);
    expect(result.truncated).toBe(true);
  });

  it("clamps limit to the hard max even if a caller asks for more", async () => {
    safeFetchTextMock.mockImplementation(async (url: string) => {
      if (url === "https://example.com/robots.txt") return NOT_FOUND;
      if (url === "https://example.com/sitemap.xml") {
        const urls = Array.from({ length: 80 }, (_, i) => `<url><loc>https://example.com/p${i}</loc></url>`).join("");
        return res(`<urlset>${urls}</urlset>`, 200, "application/xml");
      }
      return NOT_FOUND;
    });

    const result = await discoverPages("https://example.com/", { limit: 999 });
    expect(result.pages.length).toBeLessThanOrEqual(DISCOVERY_HARD_MAX);
  });
});

describe("discoverPages — link-crawl fallback", () => {
  it("falls back to a link crawl when the sitemap is missing", async () => {
    safeFetchTextMock.mockImplementation(async (url: string) => {
      if (url === "https://example.com/robots.txt") return NOT_FOUND;
      if (url === "https://example.com/sitemap.xml") return NOT_FOUND;
      if (url === "https://example.com/") {
        return res(`<html><body><a href="/a">a</a><a href="/b">b</a></body></html>`);
      }
      return res(`<html><body></body></html>`);
    });

    const result = await discoverPages("https://example.com/");
    expect(result.method).toBe("crawl");
    const urls = result.pages.map((p) => p.url);
    expect(urls).toContain("https://example.com/");
    expect(urls).toContain("https://example.com/a");
    expect(urls).toContain("https://example.com/b");
  });

  it("falls back to a link crawl when the sitemap exists but is empty", async () => {
    safeFetchTextMock.mockImplementation(async (url: string) => {
      if (url === "https://example.com/robots.txt") return NOT_FOUND;
      if (url === "https://example.com/sitemap.xml") return res(`<urlset></urlset>`, 200, "application/xml");
      if (url === "https://example.com/") return res(`<html><body><a href="/only">only</a></body></html>`);
      return res(`<html></html>`);
    });

    const result = await discoverPages("https://example.com/");
    expect(result.method).toBe("crawl");
    expect(result.pages.map((p) => p.url)).toContain("https://example.com/only");
  });

  it("always includes the root even if the crawl finds nothing else", async () => {
    safeFetchTextMock.mockImplementation(async (url: string) => {
      if (url === "https://example.com/robots.txt") return NOT_FOUND;
      if (url === "https://example.com/sitemap.xml") return NOT_FOUND;
      return res(`<html><body>no links here</body></html>`);
    });

    const result = await discoverPages("https://example.com/");
    expect(result.pages.map((p) => p.url)).toEqual(["https://example.com/"]);
  });
});

describe("discoverPages — normalization", () => {
  it("normalizes root URL trailing slash and strips fragments", async () => {
    safeFetchTextMock.mockImplementation(async (url: string) => {
      if (url === "https://example.com/robots.txt") return NOT_FOUND;
      if (url === "https://example.com/sitemap.xml") return NOT_FOUND;
      return res(`<html></html>`);
    });

    const result = await discoverPages("https://example.com/#section");
    expect(result.rootUrl).toBe("https://example.com/");
  });
});
