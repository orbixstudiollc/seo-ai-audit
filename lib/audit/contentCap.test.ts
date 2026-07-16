import { describe, expect, it } from "vitest";
import { capAuditContent, MAX_CONTENT_WORDS } from "./contentCap";

function htmlArticle(words: number): string {
  const body = Array.from({ length: words }, (_, i) => `word${i}`).join(" ");
  return `<article><h1>Title</h1><p>${body}</p></article>`;
}

describe("capAuditContent", () => {
  it("passes short articles through untouched, as HTML", () => {
    const html = htmlArticle(500);
    const result = capAuditContent(html);
    expect(result.truncated).toBe(false);
    expect(result.isHtml).toBe(true);
    expect(result.content).toBe(html);
    expect(result.doc.wordCount).toBeLessThanOrEqual(MAX_CONTENT_WORDS);
  });

  it("truncates an oversized article to the word cap", () => {
    const html = htmlArticle(MAX_CONTENT_WORDS + 5_000);
    const result = capAuditContent(html);
    expect(result.truncated).toBe(true);
    expect(result.isHtml).toBe(false);
    expect(result.doc.wordCount).toBeLessThanOrEqual(MAX_CONTENT_WORDS);
  });

  it("stays right at the cap without truncating", () => {
    // -1 to account for the single-word "Title" heading also parsed into wordCount.
    const html = htmlArticle(MAX_CONTENT_WORDS - 1);
    const result = capAuditContent(html);
    expect(result.truncated).toBe(false);
  });
});
