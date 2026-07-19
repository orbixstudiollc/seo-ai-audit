import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/import", () => ({ safeFetchText: vi.fn() }));

import { safeFetchText } from "@/lib/import";
import { fetchSitemapUrls } from "../sitemap";

const safeFetchTextMock = safeFetchText as unknown as Mock;

function textResult(text: string, status = 200) {
  return { finalUrl: "", status, contentType: "application/xml", text };
}

beforeEach(() => {
  safeFetchTextMock.mockReset();
});

describe("fetchSitemapUrls", () => {
  it("extracts <loc> entries from a flat sitemap", async () => {
    safeFetchTextMock.mockResolvedValue(
      textResult(
        `<?xml version="1.0"?><urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>`,
      ),
    );
    const urls = await fetchSitemapUrls("https://example.com");
    expect(urls).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(safeFetchTextMock).toHaveBeenCalledWith("https://example.com/sitemap.xml", expect.any(Object));
  });

  it("follows a sitemap index and merges child <loc> entries", async () => {
    safeFetchTextMock
      .mockResolvedValueOnce(
        textResult(
          `<sitemapindex><sitemap><loc>https://example.com/sitemap-a.xml</loc></sitemap><sitemap><loc>https://example.com/sitemap-b.xml</loc></sitemap></sitemapindex>`,
        ),
      )
      .mockResolvedValueOnce(textResult(`<urlset><url><loc>https://example.com/a1</loc></url></urlset>`))
      .mockResolvedValueOnce(textResult(`<urlset><url><loc>https://example.com/b1</loc></url></urlset>`));

    const urls = await fetchSitemapUrls("https://example.com");
    expect(urls).toEqual(["https://example.com/a1", "https://example.com/b1"]);
    expect(safeFetchTextMock).toHaveBeenCalledTimes(3);
  });

  it("caps sitemap-index children at 5", async () => {
    const children = Array.from({ length: 8 }, (_, i) => `https://example.com/s${i}.xml`);
    safeFetchTextMock.mockResolvedValueOnce(
      textResult(`<sitemapindex>${children.map((c) => `<sitemap><loc>${c}</loc></sitemap>`).join("")}</sitemapindex>`),
    );
    for (let i = 0; i < 5; i++) {
      safeFetchTextMock.mockResolvedValueOnce(textResult(`<urlset><url><loc>https://example.com/p${i}</loc></url></urlset>`));
    }
    const urls = await fetchSitemapUrls("https://example.com");
    expect(urls).toHaveLength(5);
    expect(safeFetchTextMock).toHaveBeenCalledTimes(6); // index + 5 children, never the other 3
  });

  it("returns an empty array when sitemap.xml 404s (the common case)", async () => {
    safeFetchTextMock.mockResolvedValue(textResult("Not Found", 404));
    await expect(fetchSitemapUrls("https://example.com")).resolves.toEqual([]);
  });

  it("returns an empty array (never throws) when the fetch itself rejects", async () => {
    safeFetchTextMock.mockRejectedValue(new Error("network down"));
    await expect(fetchSitemapUrls("https://example.com")).resolves.toEqual([]);
  });

  it("skips a broken child sitemap but keeps the rest", async () => {
    safeFetchTextMock
      .mockResolvedValueOnce(
        textResult(
          `<sitemapindex><sitemap><loc>https://example.com/broken.xml</loc></sitemap><sitemap><loc>https://example.com/ok.xml</loc></sitemap></sitemapindex>`,
        ),
      )
      .mockRejectedValueOnce(new Error("broken"))
      .mockResolvedValueOnce(textResult(`<urlset><url><loc>https://example.com/ok1</loc></url></urlset>`));

    const urls = await fetchSitemapUrls("https://example.com");
    expect(urls).toEqual(["https://example.com/ok1"]);
  });
});
