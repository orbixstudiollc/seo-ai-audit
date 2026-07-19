import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/lib/import", () => ({ safeFetchText: vi.fn() }));

import { safeFetchText } from "@/lib/import";
import { crawlSameOriginLinks } from "../linkCrawl";
import { parseRobots } from "../robots";

const safeFetchTextMock = safeFetchText as unknown as Mock;

function htmlPage(links: string[]) {
  return {
    finalUrl: "",
    status: 200,
    contentType: "text/html; charset=utf-8",
    text: `<html><body>${links.map((l) => `<a href="${l}">link</a>`).join("")}</body></html>`,
  };
}

beforeEach(() => {
  safeFetchTextMock.mockReset();
});

describe("crawlSameOriginLinks", () => {
  it("discovers same-origin links up to maxDepth, excluding cross-origin", async () => {
    safeFetchTextMock.mockImplementation(async (url: string) => {
      if (url === "https://example.com/") {
        return htmlPage(["/a", "/b", "https://other.com/evil"]);
      }
      if (url === "https://example.com/a") return htmlPage(["/a/child"]);
      if (url === "https://example.com/b") return htmlPage([]);
      return htmlPage([]);
    });

    const result = await crawlSameOriginLinks(new URL("https://example.com/"), {
      maxPages: 10,
      maxDepth: 2,
    });

    expect(result).toContain("https://example.com/");
    expect(result).toContain("https://example.com/a");
    expect(result).toContain("https://example.com/b");
    expect(result).not.toContain("https://other.com/evil");
  });

  it("stops descending past maxDepth (depth-2 pages are recorded but not fetched)", async () => {
    safeFetchTextMock.mockImplementation(async (url: string) => {
      if (url === "https://example.com/") return htmlPage(["/lvl1"]);
      if (url === "https://example.com/lvl1") return htmlPage(["/lvl2"]);
      return htmlPage(["/lvl3-should-never-appear"]);
    });

    const result = await crawlSameOriginLinks(new URL("https://example.com/"), {
      maxPages: 10,
      maxDepth: 1,
    });

    expect(result).toEqual(["https://example.com/", "https://example.com/lvl1"]);
    // lvl1 is at depth 1 == maxDepth, so its links are never fetched/expanded.
    expect(safeFetchTextMock).toHaveBeenCalledTimes(1);
  });

  it("stops once maxPages is reached, bounding cost on a huge site", async () => {
    safeFetchTextMock.mockImplementation(async (url: string) => {
      const n = Number(url.split("/").pop());
      return htmlPage([`/${n + 1}`]);
    });

    const result = await crawlSameOriginLinks(new URL("https://example.com/0"), {
      maxPages: 3,
      maxDepth: 10,
    });

    expect(result).toHaveLength(3);
  });

  it("skips robots-disallowed paths without fetching them", async () => {
    const robots = parseRobots("User-agent: *\nDisallow: /private\n");
    safeFetchTextMock.mockImplementation(async (url: string) => {
      if (url === "https://example.com/") return htmlPage(["/private", "/public"]);
      return htmlPage([]);
    });

    const result = await crawlSameOriginLinks(new URL("https://example.com/"), {
      maxPages: 10,
      maxDepth: 2,
      robots,
    });

    expect(result).toContain("https://example.com/public");
    expect(result).not.toContain("https://example.com/private");
    expect(safeFetchTextMock).not.toHaveBeenCalledWith("https://example.com/private", expect.anything());
  });

  it("skips non-HTML responses without crashing", async () => {
    safeFetchTextMock.mockImplementation(async (url: string) => {
      if (url === "https://example.com/") return htmlPage(["/report.pdf"]);
      return { finalUrl: "", status: 200, contentType: "application/pdf", text: "%PDF-1.4" };
    });

    const result = await crawlSameOriginLinks(new URL("https://example.com/"), {
      maxPages: 10,
      maxDepth: 2,
    });

    expect(result).toContain("https://example.com/report.pdf"); // recorded as a page...
    expect(result).toHaveLength(2); // ...but never expanded for further links
  });

  it("tolerates a fetch failure on one page and keeps going", async () => {
    safeFetchTextMock.mockImplementation(async (url: string) => {
      if (url === "https://example.com/") return htmlPage(["/broken", "/ok"]);
      if (url === "https://example.com/broken") throw new Error("boom");
      return htmlPage([]);
    });

    const result = await crawlSameOriginLinks(new URL("https://example.com/"), {
      maxPages: 10,
      maxDepth: 2,
    });

    expect(result).toContain("https://example.com/broken"); // still recorded
    expect(result).toContain("https://example.com/ok");
  });
});
