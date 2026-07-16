import { describe, expect, it } from "vitest";
import { parseArticleListCsv } from "./parseArticleList";
import { MAX_ARTICLE_LIST_ROWS } from "./constants";

describe("parseArticleListCsv", () => {
  it("parses url + title rows", () => {
    const csv = "url,title\nhttps://example.com/a,First Article\nhttps://example.com/b,Second Article\n";
    const result = parseArticleListCsv(csv);
    expect(result.fatalError).toBeNull();
    expect(result.rows).toEqual([
      { url: "https://example.com/a", title: "First Article", rowNumber: 2 },
      { url: "https://example.com/b", title: "Second Article", rowNumber: 3 },
    ]);
  });

  it("title is optional — missing cell becomes null, not an empty string", () => {
    const csv = "url,title\nhttps://example.com/a,\n";
    const result = parseArticleListCsv(csv);
    expect(result.rows).toEqual([{ url: "https://example.com/a", title: null, rowNumber: 2 }]);
  });

  it("works with a url-only CSV (no title column at all)", () => {
    const csv = "url\nhttps://example.com/a\nhttps://example.com/b\n";
    const result = parseArticleListCsv(csv);
    expect(result.fatalError).toBeNull();
    expect(result.rows.map((r) => r.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("header matching is case- and whitespace-insensitive", () => {
    const csv = " URL , Title \nhttps://example.com/a,First\n";
    const result = parseArticleListCsv(csv);
    expect(result.fatalError).toBeNull();
    expect(result.rows).toEqual([{ url: "https://example.com/a", title: "First", rowNumber: 2 }]);
  });

  it("correctly parses a quoted title containing a comma (the exact case a naive split(',') mis-parses)", () => {
    const csv = 'url,title\nhttps://example.com/a,"SEO Tips, Tricks, and Tools"\n';
    const result = parseArticleListCsv(csv);
    expect(result.rows).toEqual([
      { url: "https://example.com/a", title: "SEO Tips, Tricks, and Tools", rowNumber: 2 },
    ]);
  });

  it("fatal error when there is no url column at all", () => {
    const csv = "title\nSomething\n";
    const result = parseArticleListCsv(csv);
    expect(result.fatalError).toMatch(/url/i);
    expect(result.rows).toEqual([]);
  });

  it("skips rows with an empty url and warns, but keeps the rest", () => {
    const csv = "url,title\n,Missing URL\nhttps://example.com/b,Has URL\n";
    const result = parseArticleListCsv(csv);
    expect(result.fatalError).toBeNull();
    expect(result.rows).toEqual([{ url: "https://example.com/b", title: "Has URL", rowNumber: 3 }]);
    expect(result.warnings.some((w) => /row 2/i.test(w) && /missing url/i.test(w))).toBe(true);
  });

  it("fatal error when every row is empty (nothing usable at all)", () => {
    const csv = "url,title\n,\n,\n";
    const result = parseArticleListCsv(csv);
    expect(result.fatalError).toMatch(/no rows/i);
    expect(result.rows).toEqual([]);
  });

  it(`rejects (does not silently truncate) a CSV with more than ${MAX_ARTICLE_LIST_ROWS} rows`, () => {
    const rows = Array.from({ length: MAX_ARTICLE_LIST_ROWS + 5 }, (_, i) => `https://example.com/${i}`);
    const csv = "url\n" + rows.join("\n") + "\n";
    const result = parseArticleListCsv(csv);
    expect(result.fatalError).toMatch(new RegExp(String(MAX_ARTICLE_LIST_ROWS)));
    // A hard reject, not a partial success — nothing should be returned to import.
    expect(result.rows).toEqual([]);
  });

  it(`accepts exactly ${MAX_ARTICLE_LIST_ROWS} rows (the boundary is inclusive)`, () => {
    const rows = Array.from({ length: MAX_ARTICLE_LIST_ROWS }, (_, i) => `https://example.com/${i}`);
    const csv = "url\n" + rows.join("\n") + "\n";
    const result = parseArticleListCsv(csv);
    expect(result.fatalError).toBeNull();
    expect(result.rows).toHaveLength(MAX_ARTICLE_LIST_ROWS);
  });
});
