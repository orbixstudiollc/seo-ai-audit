import { describe, test, expect } from "vitest";
import { canonicalize, computeParsedDocument } from "./parse";

describe("canonicalize", () => {
  test("strips BOM/zero-width chars, normalizes line endings and smart quotes/dashes", () => {
    const input = "﻿Hello​ World\r\n“Quoted” and ‘single’\r— em – en\r\n";
    const out = canonicalize(input);
    expect(out).toBe('Hello World\n"Quoted" and \'single\'\n-- em - en\n');
  });

  test("is idempotent", () => {
    const once = canonicalize("café “hi”");
    expect(canonicalize(once)).toBe(once);
  });
});

describe("computeParsedDocument (markdown input)", () => {
  const md = `# What is photosynthesis?

Photosynthesis is the process by which plants convert light into energy. It happens in chloroplasts.

## How does it work?

Plants use chlorophyll to absorb light energy first.

- Light absorption
- Carbon fixation
`;

  test("extracts top-level headings with depth/text/index", () => {
    const doc = computeParsedDocument(md, false);
    expect(doc.headings).toEqual([
      { depth: 1, text: "What is photosynthesis?", index: 0 },
      { depth: 2, text: "How does it work?", index: 2 },
    ]);
  });

  test("plainText keeps block boundaries separated (no merged words)", () => {
    const doc = computeParsedDocument(md, false);
    expect(doc.plainText).not.toMatch(/energy\.It/);
    expect(doc.plainText).toContain("photosynthesis?");
    expect(doc.plainText).toContain("Light absorption");
  });

  test("wordCount is positive and roughly matches plainText word count", () => {
    const doc = computeParsedDocument(md, false);
    expect(doc.wordCount).toBeGreaterThan(20);
  });

  test("hasJsonLd is false when no script tag present", () => {
    const doc = computeParsedDocument(md, false);
    expect(doc.hasJsonLd).toBe(false);
  });

  test("doc.raw is the canonicalized original, not html-converted", () => {
    const doc = computeParsedDocument("Hello “world”\r\n", false);
    expect(doc.raw).toBe('Hello "world"\n');
  });
});

describe("computeParsedDocument (HTML input)", () => {
  const html = `<!DOCTYPE html><html><head><title>Ignore me</title>
<script type="application/ld+json">{"@type":"Article"}</script>
</head><body>
<article>
<h1>What is Photosynthesis?</h1>
<p>Photosynthesis is the process by which plants convert light into energy.</p>
<h2>How does it work?</h2>
<p>Plants use <strong>chlorophyll</strong> to absorb light. According to <a href="https://example.com/study">this study</a>, it varies.</p>
<ul><li>Light absorption</li><li>Carbon fixation</li></ul>
<table><tr><th>Stage</th><th>Duration</th></tr><tr><td>Light reaction</td><td>fast</td></tr></table>
</article>
</body></html>`;

  test("detects JSON-LD", () => {
    const doc = computeParsedDocument(html, true);
    expect(doc.hasJsonLd).toBe(true);
  });

  test("head/title content does not leak into plainText", () => {
    const doc = computeParsedDocument(html, true);
    expect(doc.plainText).not.toContain("Ignore me");
  });

  test("headings, list, table, and links all parse from converted markdown", () => {
    const doc = computeParsedDocument(html, true);
    expect(doc.headings.map((h) => h.text)).toEqual(["What is Photosynthesis?", "How does it work?"]);
    expect(doc.plainText).toContain("Light absorption");
    expect(doc.plainText).toContain("Stage | Duration");
    let linkCount = 0;
    for (const node of doc.ast.children) {
      if (node.type === "paragraph") {
        for (const child of node.children) if (child.type === "link") linkCount++;
      }
    }
    expect(linkCount).toBe(1);
  });

  test("plain markdown without HTML never has JSON-LD", () => {
    const doc = computeParsedDocument("# Title\n\nJust prose.\n", false);
    expect(doc.hasJsonLd).toBe(false);
  });

  test("markdown paste that merely shows a JSON-LD script tag as text is not mistaken for real schema", () => {
    const doc = computeParsedDocument(
      '# How to add JSON-LD\n\nPaste this: `<script type="application/ld+json">{}</script>`\n',
      false,
    );
    expect(doc.hasJsonLd).toBe(false);
  });
});
