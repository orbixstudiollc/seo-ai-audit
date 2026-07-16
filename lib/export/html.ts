import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

/**
 * Converts the optimized markdown to clean semantic HTML (same unified chain
 * the rest of the workspace uses) and embeds the templated JSON-LD as a
 * <script type="application/ld+json"> block inside a full document skeleton,
 * ready to download or paste into a CMS.
 */

// One frozen processor, reused for every export. All plugins in this chain
// are synchronous, so processSync is safe.
const htmlProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeStringify);

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

const H1_RE = /^#\s+(.+)$/m;
const FALLBACK_TITLE = "Optimized Content";

function extractTitle(markdown: string): string {
  const match = H1_RE.exec(markdown);
  return match ? match[1].trim() : FALLBACK_TITLE;
}

/**
 * Escapes every `<` in the JSON-LD payload with the JSON unicode escape for
 * "less-than", which makes
 * a literal `</script>` in Q/A text unable to terminate the script block.
 */
function safeJsonLd(jsonLd: string): string {
  return jsonLd.replace(/</g, "\\u003c");
}

export function buildOptimizedHtml(markdown: string, jsonLd: string | null): string {
  const body = String(htmlProcessor.processSync(markdown));
  const title = escapeHtml(extractTitle(markdown));
  const jsonLdBlock = jsonLd
    ? `\n<script type="application/ld+json">\n${safeJsonLd(jsonLd)}\n</script>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>${jsonLdBlock}
</head>
<body>
<main>
<article>
${body}
</article>
</main>
</body>
</html>
`;
}
