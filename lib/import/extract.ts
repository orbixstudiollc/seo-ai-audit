import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { ImportError } from "./errors";

/**
 * Readability extraction over a linkedom document (light server-side DOM —
 * no jsdom). The returned `contentHtml` is what feeds
 * `computeParsedDocument(content, /* isHtml *\/ true)` in @aeo/scoring.
 */

const EXTRACT_FAILED_MESSAGE =
  "Could not find a readable article on this page — paste the article text instead.";

export interface ExtractedArticle {
  title: string;
  contentHtml: string;
  excerpt: string;
  wordCount: number;
}

export function extractArticle(html: string, url: string): ExtractedArticle {
  const { document } = parseHTML(html);

  // Best-effort base for relative-URL resolution inside Readability.
  if (document.head !== null && document.querySelector("base") === null) {
    const base = document.createElement("base");
    base.setAttribute("href", url);
    document.head.appendChild(base);
  }

  let result: ReturnType<Readability["parse"]>;
  try {
    result = new Readability(document).parse();
  } catch {
    throw new ImportError("not_html", EXTRACT_FAILED_MESSAGE);
  }

  const contentHtml = result?.content ?? "";
  const textContent = result?.textContent ?? "";
  if (result === null || contentHtml === "" || textContent.trim() === "") {
    throw new ImportError("not_html", EXTRACT_FAILED_MESSAGE);
  }

  return {
    title: (result.title ?? "").trim(),
    contentHtml,
    excerpt: (result.excerpt ?? "").trim(),
    wordCount: textContent.split(/\s+/).filter((word) => word !== "").length,
  };
}
