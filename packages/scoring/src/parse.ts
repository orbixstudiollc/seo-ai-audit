import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { toString as mdastToString } from "mdast-util-to-string";
import type { Root, RootContent, TableRow } from "mdast";
import type { ParsedDocument } from "./types";

/**
 * One frozen unified processor, reused for every parse. `.parse()` alone
 * (no `.run()`/`.stringify()`) is enough to get an mdast `Root` — GFM syntax
 * (tables, strikethrough, autolinks) is registered via micromark/fromMarkdown
 * extensions that `.parse()` already applies.
 */
const markdownProcessor = unified().use(remarkParse).use(remarkGfm);

// ---------------------------------------------------------------------------
// canonicalize
// ---------------------------------------------------------------------------

/** BOM (U+FEFF) + zero-width space/joiners/word-joiner. */
const ZERO_WIDTH_AND_BOM_RE = /[﻿​‌‍⁠]/g;

/**
 * Canonicalize raw article text before parsing or hashing:
 * - Unicode NFC normalize
 * - strip BOM / zero-width characters
 * - normalize CRLF/CR line endings to LF
 * - normalize smart quotes/dashes to ASCII equivalents
 *
 * Exported on its own (not just used inside `computeParsedDocument`) so the
 * cache-key hash (sha256 of canonicalized content) can reuse the exact same
 * transform without re-running the parser. Idempotent: canonicalize(x) is a
 * fixed point, so calling it twice is safe and cheap.
 */
export function canonicalize(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(ZERO_WIDTH_AND_BOM_RE, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/—/g, "--")
    .replace(/–/g, "-");
}

// ---------------------------------------------------------------------------
// JSON-LD detection (S7 depends on this)
// ---------------------------------------------------------------------------

const JSON_LD_SCRIPT_RE = /<script\b[^>]*\btype\s*=\s*(["'])application\/ld\+json\1[^>]*>/i;

// ---------------------------------------------------------------------------
// HTML -> markdown-ish normalization (isHtml input path)
// ---------------------------------------------------------------------------
// ponytail: regex-based, not a real HTML parser (no rehype-parse/jsdom in
// this package's deps). Handles the tag subset a readability-cleaned article
// actually contains: heading levels, paragraphs, links (kept as markdown
// links so S9's link-based citation check still works), lists, tables, code
// blocks, and generic wrapper tags. Anything odder degrades gracefully to
// plain stripped text rather than throwing. Upgrade path if HTML fidelity
// ever matters: add rehype-parse + hast-util-to-mdast as real deps.

const TAG_RE = /<[^>]+>/g;

function stripTags(html: string): string {
  return html.replace(TAG_RE, "").trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "--",
  ndash: "-",
  hellip: "...",
  ldquo: '"',
  rdquo: '"',
  lsquo: "'",
  rsquo: "'",
};

/** ponytail: common named entities only, plus numeric/hex — not the full HTML5 table. */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

function convertHtmlTables(html: string): string {
  return html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_match, inner: string) => {
    const rows: string[][] = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(inner))) {
      const cells: string[] = [];
      const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRe.exec(rowMatch[1]))) {
        cells.push(stripTags(cellMatch[1]).replace(/\|/g, "/") || " ");
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return "";
    const colCount = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]): string[] => {
      const copy = r.slice();
      while (copy.length < colCount) copy.push(" ");
      return copy;
    };
    const lines = [`| ${pad(rows[0]).join(" | ")} |`, `| ${Array(colCount).fill("---").join(" | ")} |`];
    for (const r of rows.slice(1)) lines.push(`| ${pad(r).join(" | ")} |`);
    return `\n\n${lines.join("\n")}\n\n`;
  });
}

const WRAPPER_TAGS = "p|div|section|article|main|header|footer|aside|blockquote|ul|ol";

function htmlToMarkdownish(html: string): string {
  let out = html;
  out = out.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "");
  out = out.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => `\n\n\`\`\`\n${stripTags(inner)}\n\`\`\`\n\n`);
  // links before generic tag-stripping so the href survives as markdown syntax
  out = out.replace(/<a\b[^>]*\shref=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
    const clean = stripTags(text);
    return clean ? `[${clean}](${href})` : "";
  });
  out = convertHtmlTables(out);
  out = out.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, text: string) => `\n\n${"#".repeat(Number(level))} ${stripTags(text)}\n\n`);
  out = out.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, text: string) => `\n- ${stripTags(text)}\n`);
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");
  out = out.replace(new RegExp(`<\\/(${WRAPPER_TAGS})>`, "gi"), "\n\n");
  out = out.replace(new RegExp(`<(${WRAPPER_TAGS})\\b[^>]*>`, "gi"), "\n\n");
  out = out.replace(TAG_RE, ""); // drop anything left: span/strong/em/img/etc.
  out = decodeHtmlEntities(out);
  out = canonicalize(out); // entities can materialize smart quotes/dashes; normalize again
  out = out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

// ---------------------------------------------------------------------------
// mdast -> plain text (block-level siblings need an inserted separator;
// mdast-util-to-string concatenates with none, which silently merges
// adjacent blocks' words together)
// ---------------------------------------------------------------------------

/** Exported for reuse by signal code that needs the text of a subset of nodes (e.g. one section). */
export function blockNodesToText(nodes: readonly RootContent[]): string {
  return nodes
    .map((node) => blockNodeToText(node))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function blockNodeToText(node: RootContent): string {
  switch (node.type) {
    case "list":
      return node.children.map((item) => blockNodeToText(item)).filter(Boolean).join("\n");
    case "listItem":
      return blockNodesToText(node.children);
    case "blockquote":
      return blockNodesToText(node.children);
    case "table":
      return node.children.map((row) => tableRowToText(row)).filter(Boolean).join("\n");
    case "code":
    case "yaml":
    case "html":
    case "thematicBreak":
    case "definition":
      // not prose: excluded from plainText/word counts entirely
      return "";
    default:
      // paragraph, heading, and anything else: inline children flow together
      // as-is (that's correct — no separator needed between inline nodes).
      return mdastToString(node, { includeHtml: false }).trim();
  }
}

function tableRowToText(row: TableRow): string {
  return row.children
    .map((cell) => mdastToString(cell, { includeHtml: false }).trim())
    .filter(Boolean)
    .join(" | ");
}

function countWords(text: string): number {
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function extractHeadings(ast: Root): ParsedDocument["headings"] {
  const headings: ParsedDocument["headings"] = [];
  ast.children.forEach((node, index) => {
    if (node.type === "heading") {
      headings.push({ depth: node.depth, text: mdastToString(node, { includeHtml: false }).trim(), index });
    }
  });
  return headings;
}

// ---------------------------------------------------------------------------
// public entry point
// ---------------------------------------------------------------------------

/**
 * Build a `ParsedDocument` from raw input. `isHtml` selects the source
 * shape: `false` for pasted markdown/plain text (parsed directly), `true`
 * for a fetched HTML page (best-effort normalized to markdown first, then
 * parsed through the same pipeline so every DET signal only ever has to
 * deal with one AST shape).
 */
export function computeParsedDocument(raw: string, isHtml: boolean): ParsedDocument {
  const canonical = canonicalize(raw);
  // Gated on isHtml: a plain markdown paste that merely *shows* a
  // `<script type="ld+json">` example (e.g. inside a code fence) must not be
  // mistaken for a real embedded schema — only genuine HTML input is ever
  // eligible to carry one. det.ts's S7 relies on exactly this guarantee.
  const hasJsonLd = isHtml && JSON_LD_SCRIPT_RE.test(canonical);
  const markdownSource = isHtml ? htmlToMarkdownish(canonical) : canonical;
  const ast = markdownProcessor.parse(markdownSource);
  const plainText = blockNodesToText(ast.children);
  const wordCount = countWords(plainText);
  const headings = extractHeadings(ast);

  return { raw: canonical, ast, plainText, wordCount, headings, hasJsonLd };
}
