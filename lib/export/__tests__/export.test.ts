import { describe, expect, it } from "vitest";
import { DET_SIGNAL_IDS, LENSES, RUB_SIGNAL_IDS } from "@aeo/scoring";
import type {
  DetSignalResult,
  Lens,
  LensScore,
  RubSignalResult,
  ScoreBreakdown,
  SignalId,
  SignalResult,
} from "@aeo/scoring";
import type {
  AuditFindings,
  RewriteHunk,
  WorkbenchAudit,
  WorkbenchDocument,
} from "../../audit/types";
import {
  buildExportBundle,
  buildOptimizedHtml,
  buildOptimizedMarkdown,
  buildRoadmapMarkdown,
  signalPriority,
} from "../index";

// --- Fixtures ----------------------------------------------------------------

const RAW_DOC = `# How to Brew Pour-Over Coffee

Coffee is a beloved beverage enjoyed worldwide. Let's explore brewing.

## What grind size should I use?

A medium-fine grind works best for pour-over brewing.

## Water temperature

Use water between 195 and 205 degrees Fahrenheit.
`;

const INTRO_AFTER =
  "Pour-over coffee needs a medium-fine grind, water at 195-205F, and a steady 3-minute pour.";
const QUOTABLE_AFTER =
  "A medium-fine grind, similar in texture to table salt, works best for pour-over brewing.";

const HUNKS: RewriteHunk[] = [
  {
    id: "intro",
    kind: "intro",
    label: "Answer-first intro",
    before: "Coffee is a beloved beverage enjoyed worldwide. Let's explore brewing.",
    after: INTRO_AFTER,
  },
  {
    id: "section-0",
    kind: "section",
    label: "Water temperature",
    before: "Use water between 195 and 205 degrees Fahrenheit.",
    after: "REJECTED REWRITE MUST NOT APPEAR",
  },
  {
    id: "quotable-0",
    kind: "quotable",
    label: "Quotable sentence",
    before: "A medium-fine grind works best for pour-over brewing.",
    after: QUOTABLE_AFTER,
  },
];

function makeBreakdown(overrides: Partial<Record<SignalId, number>> = {}): ScoreBreakdown {
  const detEntries = DET_SIGNAL_IDS.map((id) => {
    const det: DetSignalResult = { id, score: overrides[id] ?? 95, detail: {} };
    return [id, det] as const;
  });
  const rubEntries = RUB_SIGNAL_IDS.map((id) => {
    const rub: RubSignalResult = { id, score: overrides[id] ?? 95, evidence: null };
    return [id, rub] as const;
  });
  const signals = Object.fromEntries([...detEntries, ...rubEntries]) as Record<
    SignalId,
    SignalResult
  >;
  const lenses = Object.fromEntries(
    LENSES.map((lens) => [lens, { lens, score: 50, capped: false } satisfies LensScore]),
  ) as Record<Lens, LensScore>;
  return {
    lenses,
    signals,
    rubricVersion: "rubric-test",
    signalsVersion: "signals-test",
    modelId: "test-model",
  };
}

const FINDINGS: AuditFindings = {
  questionGaps: ["How much coffee should I use per cup?"],
  anchorSuggestions: [
    { claim: "Most home brewers under-extract their coffee", suggestedSourceType: "industry survey" },
  ],
  blockers: [{ issue: "The intro never states the answer", location: "opening paragraph" }],
  qaPairs: [
    {
      question: "What grind size should I use?",
      answer: "A medium-fine grind works best for pour-over brewing.",
    },
  ],
  quotables: [],
};

// Weight math for the roadmap fixture (LENS_WEIGHTS totals per signal):
//   S1  = aeo 10 + aiOverview 25 = 35;  score 60 -> priority 35 * 40 = 1400
//   S5  = aeo 5                  =  5;  score 20 -> priority  5 * 80 =  400
//   S12 = aeo 20 + aiOverview 25 = 45;  score 60 -> priority 45 * 40 = 1800
//   S16 = geo 10 + citability 10 = 20;  score 40 -> priority 20 * 60 = 1200
//   S8  = geo 15 + citability 20 = 35;  score 75 -> priority 35 * 25 =  875 (long-term band)
// Naive (100 - score) ordering would rank S5 over S1 and S16 over S12; the
// weighted math reverses both — that is exactly what the ordering tests pin.
const ROADMAP_BREAKDOWN = makeBreakdown({ S1: 60, S5: 20, S12: 60, S16: 40, S8: 75 });

// --- buildOptimizedMarkdown ---------------------------------------------------

describe("buildOptimizedMarkdown", () => {
  it("applies accepted hunks exactly and leaves rejected hunks untouched", () => {
    const accepted = HUNKS.filter((h) => h.id !== "section-0");
    const result = buildOptimizedMarkdown({ rawContent: RAW_DOC, acceptedRewrites: accepted });

    const expected = `# How to Brew Pour-Over Coffee

${INTRO_AFTER}

## What grind size should I use?

${QUOTABLE_AFTER}

## Water temperature

Use water between 195 and 205 degrees Fahrenheit.
`;
    expect(result).toBe(expected);
    expect(result).not.toContain("REJECTED REWRITE MUST NOT APPEAR");
    // The rejected hunk's before-text survives verbatim.
    expect(result).toContain("Use water between 195 and 205 degrees Fahrenheit.");
  });

  it("returns the document unchanged when nothing is accepted", () => {
    expect(buildOptimizedMarkdown({ rawContent: RAW_DOC, acceptedRewrites: [] })).toBe(RAW_DOC);
  });

  it("skips hunks whose before-text is not present", () => {
    const ghost: RewriteHunk = {
      id: "ghost",
      kind: "section",
      label: "Ghost",
      before: "text that does not exist in the document",
      after: "should never appear",
    };
    const result = buildOptimizedMarkdown({ rawContent: RAW_DOC, acceptedRewrites: [ghost] });
    expect(result).toBe(RAW_DOC);
  });

  it("keeps replacement-pattern characters in the after-text literal", () => {
    const dollar: RewriteHunk = {
      id: "dollar",
      kind: "quotable",
      label: "Dollar",
      before: "beloved beverage",
      after: "$& costs $' about $2",
    };
    const result = buildOptimizedMarkdown({ rawContent: RAW_DOC, acceptedRewrites: [dollar] });
    expect(result).toContain("$& costs $' about $2");
    expect(result).not.toContain("beloved beverage");
  });
});

// --- buildOptimizedHtml --------------------------------------------------------

describe("buildOptimizedHtml", () => {
  it("renders semantic HTML in a full document skeleton with the JSON-LD embedded", () => {
    const jsonLd = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage" }, null, 2);
    const html = buildOptimizedHtml(RAW_DOC, jsonLd);

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>How to Brew Pour-Over Coffee</title>");
    expect(html).toContain("<h1>How to Brew Pour-Over Coffee</h1>");
    expect(html).toContain("<h2>What grind size should I use?</h2>");
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type": "FAQPage"');
    expect(html).toContain("<article>");
    expect(html).toContain("</html>");
  });

  it("omits the script block when there is no JSON-LD", () => {
    const html = buildOptimizedHtml(RAW_DOC, null);
    expect(html).not.toContain("application/ld+json");
  });

  it("escapes script-terminating sequences inside the JSON-LD payload", () => {
    const jsonLd = JSON.stringify({ text: "</script><script>alert(1)</script>" });
    const html = buildOptimizedHtml(RAW_DOC, jsonLd);
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>\\u003cscript>alert(1)");
  });

  it("falls back to a default title when the markdown has no H1", () => {
    const html = buildOptimizedHtml("Just a paragraph, no heading.", null);
    expect(html).toContain("<title>Optimized Content</title>");
  });
});

// --- buildRoadmapMarkdown -------------------------------------------------------

describe("buildRoadmapMarkdown", () => {
  const md = buildRoadmapMarkdown(ROADMAP_BREAKDOWN, FINDINGS);
  const quick = md.slice(md.indexOf("## Quick Wins"), md.indexOf("## Strategic"));
  const strategic = md.slice(md.indexOf("## Strategic"), md.indexOf("## Long-term"));
  const longterm = md.slice(md.indexOf("## Long-term"));

  it("computes priority as weight x (100 - score) summed across lenses", () => {
    expect(signalPriority("S1", ROADMAP_BREAKDOWN)).toBe(1400);
    expect(signalPriority("S5", ROADMAP_BREAKDOWN)).toBe(400);
    expect(signalPriority("S12", ROADMAP_BREAKDOWN)).toBe(1800);
    expect(signalPriority("S16", ROADMAP_BREAKDOWN)).toBe(1200);
    expect(signalPriority("S8", ROADMAP_BREAKDOWN)).toBe(875);
  });

  it("orders quick wins by the weighted priority, not by raw score", () => {
    // S5 has the worse score (20 vs 60) but S1 carries 7x the lens weight.
    expect(quick).toContain("(S1) — score 60/100 · priority 1400");
    expect(quick).toContain("(S5) — score 20/100 · priority 400");
    expect(quick.indexOf("(S1)")).toBeLessThan(quick.indexOf("(S5)"));
  });

  it("orders strategic items by the weighted priority, not by raw score", () => {
    // S16 has the worse score (40 vs 60) but S12 carries more than twice the weight.
    expect(strategic).toContain("(S12) — score 60/100 · priority 1800");
    expect(strategic).toContain("(S16) — score 40/100 · priority 1200");
    expect(strategic.indexOf("(S12)")).toBeLessThan(strategic.indexOf("(S16)"));
  });

  it("groups DET signals as quick wins, RUB signals as strategic, and the 70-89 band as long-term", () => {
    expect(quick).toContain("(S1)");
    expect(quick).toContain("(S5)");
    expect(strategic).toContain("(S12)");
    expect(strategic).toContain("(S16)");
    expect(longterm).toContain("(S8) — score 75/100 · priority 875");
  });

  it("omits signals scoring 90 or above", () => {
    expect(md).not.toContain("(S3)");
    expect(md).not.toContain("(S17)");
  });

  it("folds the LLM findings into the checklist", () => {
    expect(quick).toContain("Fix AI Overview blocker:");
    expect(quick).toContain("The intro never states the answer");
    expect(strategic).toContain("Cover the question:");
    expect(strategic).toContain("How much coffee should I use per cup?");
    expect(strategic).toContain(
      '**Add a source for:** "Most home brewers under-extract their coffee" — suggested: industry survey',
    );
  });

  it("renders every item as an unchecked markdown task", () => {
    const items = md.split("\n").filter((line) => line.startsWith("- "));
    expect(items.length).toBeGreaterThan(0);
    for (const line of items) {
      expect(line.startsWith("- [ ] ")).toBe(true);
    }
  });

  it("handles null findings", () => {
    const withoutFindings = buildRoadmapMarkdown(ROADMAP_BREAKDOWN, null);
    expect(withoutFindings).toContain("(S1)");
    expect(withoutFindings).not.toContain("Fix AI Overview blocker:");
  });
});

// --- buildExportBundle -----------------------------------------------------------

describe("buildExportBundle", () => {
  const document: WorkbenchDocument = {
    id: "doc-1",
    title: "How to Brew Pour-Over Coffee",
    source: "paste",
    sourceUrl: null,
    rawContent: RAW_DOC,
    wordCount: 55,
  };

  const audit: WorkbenchAudit = {
    id: "audit-1",
    status: "completed",
    scoresStatus: "done",
    rewritesStatus: "done",
    scores: ROADMAP_BREAKDOWN,
    findings: FINDINGS,
    rewrites: { hunks: HUNKS },
    modelId: "test-model",
    createdAt: "2026-07-11T00:00:00.000Z",
  };

  it("assembles the full bundle from accepted rewrite ids", () => {
    const bundle = buildExportBundle({
      document,
      audit,
      acceptedRewriteIds: ["intro", "quotable-0"],
    });

    // Accepted hunks applied, rejected hunk untouched.
    expect(bundle.optimizedMarkdown).toContain(INTRO_AFTER);
    expect(bundle.optimizedMarkdown).toContain(QUOTABLE_AFTER);
    expect(bundle.optimizedMarkdown).not.toContain("REJECTED REWRITE MUST NOT APPEAR");

    // JSON-LD templated from the audit's Q/A pairs and embedded in the HTML.
    expect(bundle.jsonLd).not.toBeNull();
    expect(bundle.jsonLd).toContain('"@type": "FAQPage"');
    expect(bundle.optimizedHtml).toContain('<script type="application/ld+json">');
    expect(bundle.optimizedHtml).toContain('"What grind size should I use?"');
    expect(bundle.optimizedHtml).toContain(INTRO_AFTER);

    expect(bundle.roadmapMarkdown).toContain("# Optimization Roadmap");

    // scoresJson is the exact ScoreBreakdown, pretty-printed.
    expect(JSON.parse(bundle.scoresJson)).toEqual(ROADMAP_BREAKDOWN);
  });

  it("round-trips through JSON.stringify cleanly", () => {
    const bundle = buildExportBundle({ document, audit, acceptedRewriteIds: ["intro"] });
    expect(JSON.parse(JSON.stringify(bundle))).toEqual(bundle);
  });

  it("treats an unknown accepted id as accepting nothing", () => {
    const bundle = buildExportBundle({ document, audit, acceptedRewriteIds: ["nope"] });
    expect(bundle.optimizedMarkdown).toBe(RAW_DOC);
  });

  it("throws when the audit has no scores", () => {
    const scoreless: WorkbenchAudit = { ...audit, scores: null };
    expect(() =>
      buildExportBundle({ document, audit: scoreless, acceptedRewriteIds: [] }),
    ).toThrow(/no scores/);
  });
});
