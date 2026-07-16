import { describe, test, expect } from "vitest";
import { computeParsedDocument } from "../parse";
import { DET_SIGNALS } from "./det";
import type { SignalId } from "../types";

const ALL_IDS: SignalId[] = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11"];

function nWords(n: number, prefix = "word"): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");
}

const GOOD_ARTICLE = `# What is photosynthesis?

Photosynthesis is the process plants use to turn sunlight into energy. It happens inside chloroplasts using chlorophyll.

## What is chlorophyll?

Chlorophyll is the green pigment inside plant cells that absorbs sunlight for photosynthesis. It sits inside a structure called the chloroplast, and it reflects green light while absorbing red and blue wavelengths most efficiently.

According to a 2021 study, chlorophyll absorbs roughly 90% of red light within the first 100 micrometers of a leaf. Research shows that leaf thickness affects absorption by up to 15% across common crop species today. Most land plants rely on two main variants, chlorophyll a and chlorophyll b, which absorb slightly different wavelengths and together broaden the range of usable sunlight. Marine algae and some bacteria use additional pigment types to capture light at ocean depths where red wavelengths rarely reach.

Here are the main pigment types:

- Chlorophyll a
- Chlorophyll b
- Carotenoids

## How does light reaction work?

The light reaction converts sunlight into chemical energy across two photosystems working together in sequence, producing ATP and NADPH for the plant to use. This 3-step process takes about 10 nanoseconds per electron transfer, and it happens 24 hours a day in some algae species that never sleep. Photosystem II splits water molecules first, releasing electrons, protons, and oxygen gas as a byproduct. Those electrons travel through an electron transport chain toward Photosystem I, which re-energizes them using a second burst of absorbed light. The resulting proton gradient powers ATP synthase, a molecular turbine that manufactures ATP for the plant's later sugar-building reactions.

| Stage | Duration |
| --- | --- |
| Photosystem II | fast |
| Photosystem I | fast |

Water splitting releases oxygen as a byproduct of this reaction sequence. Learn more at [this external study](https://example.com/study) for details.
`;

const BAD_ARTICLE = `In today's fast-paced world, everyone is talking about photosynthesis and how important it is for understanding plant biology in general terms across many different contexts and situations that matter to people today in various ways that we will explore in this rambling introduction that never actually gets around to answering anything concrete for the reader who just wants a straight answer and instead has to wade through clause after clause of throat-clearing before any real information shows up anywhere in this paragraph at all, which is exactly the kind of opener search engines and AI answer engines tend to skip right past when they are looking for a citable, quotable, answer-first sentence to lift.

This is a huge wall of text with no subheadings anywhere in it at all and it just keeps going on and on with very long complicated sentences that never break for the reader because whoever wrote this particular article never learned that shorter sentences which convey a single idea at a time tend to be dramatically easier for both humans and machines to parse and understand, which matters quite a lot when you are trying to explain something technical like the light-dependent and light-independent reactions of photosynthesis to a general audience that has not necessarily studied biology before and may struggle with jargon-heavy explanations that assume too much prior background knowledge on the part of the reader, and this sentence alone has gone on for well over a hundred words without ever stopping to give anyone a breather or a chance to absorb a single discrete idea before the next one arrives right on top of it without warning, and then the paragraph keeps sprawling further still, piling clause upon clause about chloroplasts and stomata and the Calvin cycle without ever pausing for a period, without ever breaking into a new section, without ever offering a list, a table, a number, or a single external citation the reader could actually verify, so that by the time it finally does end, nobody skimming it on a phone screen has retained a single concrete fact, which is precisely the failure mode this whole scoring engine exists to catch and flag before it ships.

## Overview

This section does not really say much of anything new. It just restates things vaguely without citing any sources or offering any numbers.
`;

describe("DET_SIGNALS holistic good vs bad", () => {
  const goodDoc = computeParsedDocument(GOOD_ARTICLE, false);
  const badDoc = computeParsedDocument(BAD_ARTICLE, false);

  test("every signal is present, quantized to steps of 5, and 0-100", () => {
    for (const doc of [goodDoc, badDoc]) {
      for (const id of ALL_IDS) {
        const result = DET_SIGNALS[id as keyof typeof DET_SIGNALS](doc);
        expect(result.id).toBe(id);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
        expect(result.score % 5).toBe(0);
      }
    }
  });

  test("a well-structured article outscores a wall-of-text article on every strict-DET structural signal", () => {
    // S2 needs a precise 40-60 word opening-paragraph window that hand-written
    // prose won't reliably land in either direction, and S7 is a HTML-only
    // JSON-LD check that ties when neither fixture is HTML — both covered by
    // dedicated exact-input tests below instead.
    for (const id of ["S1", "S3", "S6", "S8", "S9", "S11"] as const) {
      const goodScore = DET_SIGNALS[id](goodDoc).score;
      const badScore = DET_SIGNALS[id](badDoc).score;
      expect(goodScore).toBeGreaterThan(badScore);
    }
  });

  test("S5 sentence stats: short plain sentences beat one 400-word run-on", () => {
    expect(DET_SIGNALS.S5(goodDoc).score).toBeGreaterThan(DET_SIGNALS.S5(badDoc).score);
    expect(DET_SIGNALS.S5(badDoc).detail.avgSentenceLength).toBeGreaterThan(50);
  });
});

describe("S1 answer-first intro", () => {
  test("short, direct intro with no fluff opener scores 100", () => {
    const doc = computeParsedDocument("# Title\n\nX is Y. It matters because Z.\n", false);
    const result = DET_SIGNALS.S1(doc);
    expect(result.score).toBe(100);
    expect(result.detail.fluffOpenerFound).toBe(false);
  });

  test("fluff opener within first 25 words halves the score even if short", () => {
    const doc = computeParsedDocument("# Title\n\nIn this article we will cover the basics of X and why it matters.\n", false);
    const result = DET_SIGNALS.S1(doc);
    expect(result.detail.fluffOpenerFound).toBe(true);
    expect(result.score).toBe(50);
  });

  test("no paragraph after H1 scores 0", () => {
    const doc = computeParsedDocument("# Title\n\n## Next heading\n\nBody.\n", false);
    expect(DET_SIGNALS.S1(doc).score).toBe(0);
  });
});

describe("S2 snippet-ready blocks", () => {
  test("a 50-word opening paragraph under an H2 qualifies", () => {
    const md = `# Title\n\nIntro.\n\n## Section one\n\n${nWords(50)}.\n`;
    const doc = computeParsedDocument(md, false);
    const result = DET_SIGNALS.S2(doc);
    expect(result.detail.qualifyingCount).toBe(1);
    expect(result.score).toBe(100);
  });

  test("a 20-word opening paragraph does not qualify", () => {
    const md = `# Title\n\nIntro.\n\n## Section one\n\n${nWords(20)}.\n`;
    const doc = computeParsedDocument(md, false);
    expect(DET_SIGNALS.S2(doc).score).toBe(0);
  });
});

describe("S3 question-heading coverage", () => {
  test("counts who/what/.../ends-with-? headings correctly", () => {
    const md = `# Title\n\n## What is X?\n\nBody.\n\n## Random heading\n\nBody.\n\n## Does it work\n\nBody.\n`;
    const doc = computeParsedDocument(md, false);
    const result = DET_SIGNALS.S3(doc);
    expect(result.detail.sectionCount).toBe(3);
    expect(result.detail.questionCount).toBe(2);
    expect(result.score).toBe(65); // 2/3 = 66.67% quantized to nearest 5
  });
});

describe("S4 passage chunkability", () => {
  test("flags a section over 400 words as a wall and penalizes the score", () => {
    const md = `# Title\n\n${nWords(450)}.\n`;
    const doc = computeParsedDocument(md, false);
    const result = DET_SIGNALS.S4(doc);
    expect(result.detail.overLimitCount).toBe(1);
    expect(result.score).toBeLessThan(100);
  });

  test("flags skipped heading depth (H1 -> H3, no H2) as not sane", () => {
    const md = `# Title\n\nIntro.\n\n### Skipped to H3\n\nBody.\n`;
    const doc = computeParsedDocument(md, false);
    expect(DET_SIGNALS.S4(doc).detail.headingDepthOk).toBe(false);
  });

  test("no content at all scores 0 without throwing", () => {
    const doc = computeParsedDocument("", false);
    expect(DET_SIGNALS.S4(doc).score).toBe(0);
  });
});

describe("S6 list/table density", () => {
  test("counts nested and top-level lists/tables via unist-util-visit", () => {
    const md = `# Title\n\n- a\n- b\n  - nested\n\n| h |\n| - |\n| 1 |\n`;
    const doc = computeParsedDocument(md, false);
    const result = DET_SIGNALS.S6(doc);
    expect(result.detail.listCount).toBe(2); // top-level + nested
    expect(result.detail.tableCount).toBe(1);
  });
});

describe("S7 schema presence", () => {
  test("HTML input with JSON-LD scores 100 and does not need generation", () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"Article"}</script></head><body><p>Body.</p></body></html>`;
    const doc = computeParsedDocument(html, true);
    const result = DET_SIGNALS.S7(doc);
    expect(result.score).toBe(100);
    expect(result.detail.canGenerate).toBe(false);
  });

  test("plain markdown with no schema gets a modest penalty and canGenerate=true", () => {
    const doc = computeParsedDocument("# Title\n\nBody.\n", false);
    const result = DET_SIGNALS.S7(doc);
    expect(result.score).toBeLessThan(100);
    expect(result.score).toBeGreaterThan(0);
    expect(result.detail.canGenerate).toBe(true);
  });
});

describe("S8 stat/fact density", () => {
  test("counts $, %, and unit-suffixed numbers without double-counting", () => {
    const doc = computeParsedDocument("# T\n\nIt costs $3.50 and takes 3 hours, a 42% jump over 10 years.\n", false);
    expect(DET_SIGNALS.S8(doc).detail.statCount).toBe(4);
  });
});

describe("S9 citation density", () => {
  test("counts absolute links as external but not relative/anchor links", () => {
    const md = `# T\n\n[external](https://example.com/a) and [internal](/local-page) and [anchor](#section).\n`;
    const doc = computeParsedDocument(md, false);
    expect(DET_SIGNALS.S9(doc).detail.externalLinkCount).toBe(1);
  });

  test("recognizes English and Chinese attribution phrases", () => {
    const doc = computeParsedDocument("# T\n\nAccording to researchers, 研究表明 this effect is real.\n", false);
    expect(DET_SIGNALS.S9(doc).detail.attributionCount).toBe(2);
  });
});

describe("S10 quotable-sentence rate", () => {
  test("an 8-30 word, self-contained, number-bearing sentence qualifies", () => {
    const doc = computeParsedDocument("# T\n\nA typical adult heart beats about 100000 times every single day without resting.\n", false);
    const result = DET_SIGNALS.S10(doc);
    expect(result.detail.qualifyingCount).toBe(1);
  });

  test("a sentence starting with a pronoun does not qualify even with a number", () => {
    const doc = computeParsedDocument("# T\n\nIt beats about 100000 times every single day without ever resting at all.\n", false);
    expect(DET_SIGNALS.S10(doc).detail.qualifyingCount).toBe(0);
  });

  test("a definitional 'X is Y' sentence with no number can still qualify", () => {
    const doc = computeParsedDocument("# T\n\nPhotosynthesis is the process plants use to convert sunlight into usable chemical energy.\n", false);
    expect(DET_SIGNALS.S10(doc).detail.qualifyingCount).toBe(1);
  });
});

describe("S11 section self-containedness", () => {
  test("penalizes sections whose first sentence starts with a pronoun", () => {
    const md = `# T\n\nIntro.\n\n## Section one\n\nThis is about the topic in general.\n`;
    const doc = computeParsedDocument(md, false);
    expect(DET_SIGNALS.S11(doc).detail.pronounStartCount).toBe(1);
  });

  test("penalizes generic headings like Overview/Introduction", () => {
    const md = `# T\n\nIntro.\n\n## Overview\n\nSpecific content about the actual subject matter here.\n`;
    const doc = computeParsedDocument(md, false);
    expect(DET_SIGNALS.S11(doc).detail.genericHeadingCount).toBe(1);
  });

  test("a specific heading with a non-pronoun opening sentence scores well", () => {
    const md = `# T\n\nIntro.\n\n## Chlorophyll absorption rates\n\nLeaves absorb most red light within the first cell layers.\n`;
    const doc = computeParsedDocument(md, false);
    const result = DET_SIGNALS.S11(doc);
    expect(result.detail.pronounStartCount).toBe(0);
    expect(result.detail.genericHeadingCount).toBe(0);
    expect(result.score).toBe(100);
  });
});
