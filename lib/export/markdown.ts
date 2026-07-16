import type { RewriteHunk } from "../audit/types";

/**
 * Applies the user's accepted rewrite hunks to the raw working document and
 * returns the final optimized markdown. This is the exact same accept
 * semantics the workbench uses: first-occurrence, verbatim `before` →
 * `after` replacement. Hunks whose `before` no longer appears (e.g. the text
 * was already changed by an earlier overlapping hunk) are skipped rather
 * than corrupting the document.
 */

export interface BuildOptimizedMarkdownInput {
  rawContent: string;
  acceptedRewrites: readonly RewriteHunk[];
}

export function buildOptimizedMarkdown({
  rawContent,
  acceptedRewrites,
}: BuildOptimizedMarkdownInput): string {
  return acceptedRewrites.reduce((content, hunk) => {
    if (!hunk.before || !content.includes(hunk.before)) return content;
    // Replacement is passed as a function so `$&`/`$'` sequences inside the
    // LLM-written `after` text stay literal instead of being interpreted as
    // String.replace substitution patterns.
    return content.replace(hunk.before, () => hunk.after);
  }, rawContent);
}
