import { computeParsedDocument } from "@aeo/scoring";
import type { ParsedDocument } from "@aeo/scoring";

/**
 * Per-audit cost ceiling: the LLM calls (rubric + rewrites) both embed the
 * full article inside the prompt, so an unbounded page could spend an
 * unbounded amount of the server's ANTHROPIC_API_KEY budget on one request.
 * Everything downstream (signals, scores, rewrites) is computed from the
 * SAME capped `content`/`isHtml` this returns, so the events stay internally
 * consistent.
 */
export const MAX_CONTENT_WORDS = 8_000;

export interface CappedContent {
  content: string;
  isHtml: boolean;
  doc: ParsedDocument;
  /** True when the article exceeded the cap and was truncated. */
  truncated: boolean;
}

/**
 * Caps `contentHtml` (the Readability-extracted article) to ~8k words.
 *
 * ponytail: the common case (wordCount <= cap) keeps the original HTML
 * verbatim, so structural signals (lists, tables, schema) read the real
 * markup. The rare truncation case falls back to plain text — cutting HTML
 * at a word boundary without corrupting tags needs a DOM walk, which isn't
 * worth building for a backstop that a normal-length article never hits.
 * Upgrade path: truncate via linkedom (already a dependency) if long-page
 * audits turn out to be common enough that structural fidelity matters here.
 */
export function capAuditContent(contentHtml: string): CappedContent {
  const doc = computeParsedDocument(contentHtml, true);
  if (doc.wordCount <= MAX_CONTENT_WORDS) {
    return { content: contentHtml, isHtml: true, doc, truncated: false };
  }

  const truncatedText = doc.plainText.split(/\s+/).filter(Boolean).slice(0, MAX_CONTENT_WORDS).join(" ");
  const truncatedDoc = computeParsedDocument(truncatedText, false);
  return { content: truncatedText, isHtml: false, doc: truncatedDoc, truncated: true };
}
