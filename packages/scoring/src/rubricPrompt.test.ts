import { describe, expect, it } from "vitest";
import type { Root } from "mdast";
import type { ParsedDocument } from "./types";
import { RUB_SIGNAL_IDS } from "./types";
import { RUBRIC_VERSION, buildRubricPrompt } from "./rubricPrompt";

function fakeDoc(overrides: Partial<ParsedDocument> = {}): ParsedDocument {
  return {
    raw: "# Title\n\nSome body text about widgets.",
    ast: { type: "root", children: [] } as Root,
    plainText: "Title Some body text about widgets.",
    wordCount: 6,
    headings: [{ depth: 1, text: "Title", index: 0 }],
    hasJsonLd: false,
    ...overrides,
  };
}

describe("RUBRIC_VERSION", () => {
  it("is a non-empty semver-like string", () => {
    expect(RUBRIC_VERSION).toMatch(/^v\d+\.\d+\.\d+$/);
  });
});

describe("buildRubricPrompt", () => {
  it("interpolates the requested rubric version", () => {
    const prompt = buildRubricPrompt(fakeDoc(), { rubricVersion: "v9.9.9" });

    expect(prompt).toContain("Rubric version: v9.9.9");
  });

  it("embeds the raw article content verbatim", () => {
    const doc = fakeDoc({ raw: "UNIQUE_MARKER_TEXT_12345" });

    const prompt = buildRubricPrompt(doc, { rubricVersion: RUBRIC_VERSION });

    expect(prompt).toContain("UNIQUE_MARKER_TEXT_12345");
  });

  it("renders the heading outline from doc.headings", () => {
    const doc = fakeDoc({ headings: [{ depth: 2, text: "Pricing Details", index: 3 }] });

    const prompt = buildRubricPrompt(doc, { rubricVersion: RUBRIC_VERSION });

    expect(prompt).toContain("H2: Pricing Details");
  });

  it("falls back to a placeholder when there are no headings", () => {
    const prompt = buildRubricPrompt(fakeDoc({ headings: [] }), { rubricVersion: RUBRIC_VERSION });

    expect(prompt).toContain("(no headings detected)");
  });

  it("documents every RUB signal id", () => {
    const prompt = buildRubricPrompt(fakeDoc(), { rubricVersion: RUBRIC_VERSION });

    for (const id of RUB_SIGNAL_IDS) {
      expect(prompt).toContain(id);
    }
  });

  it("carries the core anti-inflation and quote-or-default discipline", () => {
    const prompt = buildRubricPrompt(fakeDoc(), { rubricVersion: RUBRIC_VERSION });

    expect(prompt).toContain("ANTI-INFLATION MANDATE");
    expect(prompt).toContain("QUOTE-OR-DEFAULT");
    expect(prompt).toContain("FINAL SELF-CHECK");
  });
});
