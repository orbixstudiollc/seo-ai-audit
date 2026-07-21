import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ safeFetchText: vi.fn() }));
vi.mock("@/lib/import", () => ({ safeFetchText: mocks.safeFetchText }));

import { parseLocEntries, parseSitemapDeclarations, runSitemap } from "./sitemap";

function textResult(status: number, text: string) {
  return { finalUrl: "", status, contentType: "text/xml", text };
}

/** Routes safeFetchText by URL suffix so each test can script robots.txt vs
 * sitemap.xml vs a declared/child sitemap independently. */
function mockFetch(byUrl: Record<string, { status: number; text: string } | Error>): void {
  mocks.safeFetchText.mockImplementation(async (url: string) => {
    const match = Object.entries(byUrl).find(([suffix]) => url.endsWith(suffix));
    if (!match) throw new Error(`unexpected fetch: ${url}`);
    const [, value] = match;
    if (value instanceof Error) throw value;
    return textResult(value.status, value.text);
  });
}

beforeEach(() => {
  mocks.safeFetchText.mockReset();
});

describe("parseSitemapDeclarations", () => {
  it("extracts one Sitemap: declaration", () => {
    expect(parseSitemapDeclarations("User-agent: *\nSitemap: https://example.com/sitemap.xml\n")).toEqual([
      "https://example.com/sitemap.xml",
    ]);
  });

  it("extracts multiple declarations case-insensitively", () => {
    const text = "sitemap: https://example.com/a.xml\nSITEMAP:https://example.com/b.xml\n";
    expect(parseSitemapDeclarations(text)).toEqual(["https://example.com/a.xml", "https://example.com/b.xml"]);
  });

  it("returns an empty array when none declared", () => {
    expect(parseSitemapDeclarations("User-agent: *\nDisallow: /admin\n")).toEqual([]);
  });
});

describe("parseLocEntries", () => {
  it("extracts <loc> entries from a plain urlset", () => {
    const xml = `<urlset><url><loc>https://a.com/1</loc></url><url><loc>https://a.com/2</loc></url></urlset>`;
    expect(parseLocEntries(xml)).toEqual({ isIndex: false, locs: ["https://a.com/1", "https://a.com/2"] });
  });

  it("flags a sitemap index", () => {
    const xml = `<sitemapindex><sitemap><loc>https://a.com/s1.xml</loc></sitemap></sitemapindex>`;
    expect(parseLocEntries(xml)).toEqual({ isIndex: true, locs: ["https://a.com/s1.xml"] });
  });
});

describe("runSitemap", () => {
  it("uses the declared robots sitemap and reports declaredInRobots", async () => {
    mockFetch({
      "/robots.txt": { status: 200, text: "Sitemap: https://example.com/custom-sitemap.xml\n" },
      "/custom-sitemap.xml": {
        status: 200,
        text: `<urlset><url><loc>https://example.com/a</loc></url></urlset>`,
      },
    });
    const result = await runSitemap("https://example.com/");
    expect(result.sitemapUrl).toBe("https://example.com/custom-sitemap.xml");
    expect(result.declaredInRobots).toBe(true);
    expect(result.urlCount).toBe(1);
    expect(result.issues).toEqual([]);
  });

  it("falls back to /sitemap.xml and flags not-declared-in-robots", async () => {
    mockFetch({
      "/robots.txt": { status: 200, text: "User-agent: *\nDisallow:\n" },
      "/sitemap.xml": { status: 200, text: `<urlset><url><loc>https://example.com/a</loc></url></urlset>` },
    });
    const result = await runSitemap("https://example.com/");
    expect(result.sitemapUrl).toBe("https://example.com/sitemap.xml");
    expect(result.declaredInRobots).toBe(false);
    expect(result.issues).toEqual([
      { code: "not-declared-in-robots", severity: "warning", detail: "robots.txt does not declare a Sitemap:" },
    ]);
  });

  it("follows a sitemap index and merges child <loc> entries", async () => {
    mockFetch({
      "/robots.txt": { status: 200, text: "Sitemap: https://example.com/sitemap.xml\n" },
      "/sitemap.xml": {
        status: 200,
        text: `<sitemapindex><sitemap><loc>https://example.com/s1.xml</loc></sitemap><sitemap><loc>https://example.com/s2.xml</loc></sitemap></sitemapindex>`,
      },
      "/s1.xml": { status: 200, text: `<urlset><url><loc>https://example.com/a</loc></url></urlset>` },
      "/s2.xml": { status: 200, text: `<urlset><url><loc>https://example.com/b</loc></url></urlset>` },
    });
    const result = await runSitemap("https://example.com/");
    expect(result.urlCount).toBe(2);
    expect(result.sameOriginCount).toBe(2);
  });

  it("reports missing-sitemap when nothing is found at all", async () => {
    mockFetch({
      "/robots.txt": { status: 404, text: "" },
      "/sitemap.xml": { status: 404, text: "" },
    });
    const result = await runSitemap("https://example.com/");
    expect(result.sitemapUrl).toBeNull();
    expect(result.urlCount).toBe(0);
    expect(result.issues).toEqual([
      { code: "missing-sitemap", severity: "error", detail: "No sitemap found at https://example.com/sitemap.xml" },
      { code: "not-declared-in-robots", severity: "warning", detail: "robots.txt does not declare a Sitemap:" },
    ]);
  });

  it("flags a sitemap over the 50,000 URL cap", async () => {
    const manyLocs = Array.from({ length: 50_001 }, (_, i) => `<url><loc>https://example.com/${i}</loc></url>`).join("");
    mockFetch({
      "/robots.txt": { status: 404, text: "" },
      "/sitemap.xml": { status: 200, text: `<urlset>${manyLocs}</urlset>` },
    });
    const result = await runSitemap("https://example.com/");
    expect(result.issues.some((i) => i.code === "too-many-urls")).toBe(true);
  });

  it("flags mixed http/https protocols", async () => {
    mockFetch({
      "/robots.txt": { status: 200, text: "Sitemap: https://example.com/sitemap.xml\n" },
      "/sitemap.xml": {
        status: 200,
        text: `<urlset><url><loc>https://example.com/a</loc></url><url><loc>http://example.com/b</loc></url></urlset>`,
      },
    });
    const result = await runSitemap("https://example.com/");
    expect(result.issues.some((i) => i.code === "mixed-protocol")).toBe(true);
  });

  it("flags low same-origin ratio", async () => {
    mockFetch({
      "/robots.txt": { status: 200, text: "Sitemap: https://example.com/sitemap.xml\n" },
      "/sitemap.xml": {
        status: 200,
        text: `<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://other.com/b</loc></url><url><loc>https://other.com/c</loc></url></urlset>`,
      },
    });
    const result = await runSitemap("https://example.com/");
    expect(result.issues.some((i) => i.code === "low-same-origin")).toBe(true);
  });
});
