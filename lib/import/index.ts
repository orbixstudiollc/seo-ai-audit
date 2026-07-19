import { extractArticle } from "./extract";
import { fetchArticle } from "./fetchArticle";

export { ImportError, PASTE_FALLBACK_MESSAGE } from "./errors";
export type { ImportErrorKind } from "./errors";
export { assertSafeUrl, validateRedirectHop } from "./ssrfGuard";
export type { SafeUrl } from "./ssrfGuard";
export { fetchArticle } from "./fetchArticle";
export type { FetchedArticle } from "./fetchArticle";
export { safeFetchText } from "./safeFetch";
export type { SafeFetchResult } from "./safeFetch";
export { extractArticle } from "./extract";
export type { ExtractedArticle } from "./extract";

export interface ImportedArticle {
  title: string;
  contentHtml: string;
  excerpt: string;
  wordCount: number;
  finalUrl: string;
}

/**
 * The full URL import pipeline: SSRF guard -> capped/redirect-checked fetch
 * -> Readability extraction. Throws ImportError on every failure path; the
 * UI's paste fallback is the answer to all of them.
 */
export async function importFromUrl(url: string): Promise<ImportedArticle> {
  const fetched = await fetchArticle(url);
  const article = extractArticle(fetched.html, fetched.finalUrl);
  return {
    // Readability's title is usually better; <title> tag is the fallback.
    title: article.title !== "" ? article.title : fetched.title,
    contentHtml: article.contentHtml,
    excerpt: article.excerpt,
    wordCount: article.wordCount,
    finalUrl: fetched.finalUrl,
  };
}
