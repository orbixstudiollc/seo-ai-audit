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
import type { RewriteHunk, WorkbenchAudit, WorkbenchDocument } from "@/lib/audit/types";
import {
  buildWorkbenchExportBundle,
  exportFilesFor,
  slugify,
} from "@/app/components/workbench/ExportMenu";

// The menu's handler logic (bundle assembly + file descriptors) is what this
// suite pins; the Blob/anchor download itself is browser plumbing.

const RAW_DOC = `# Pour-Over Basics

Coffee is a beloved beverage. Let's explore brewing.

## Grind

A medium-fine grind works best.
`;

const HUNK: RewriteHunk = {
  id: "intro",
  kind: "intro",
  label: "Answer-first intro",
  before: "Coffee is a beloved beverage. Let's explore brewing.",
  after: "Pour-over needs a medium-fine grind and 195-205F water.",
};

function makeBreakdown(): ScoreBreakdown {
  const detEntries = DET_SIGNAL_IDS.map((id) => {
    const det: DetSignalResult = { id, score: 95, detail: {} };
    return [id, det] as const;
  });
  const rubEntries = RUB_SIGNAL_IDS.map((id) => {
    const rub: RubSignalResult = { id, score: 95, evidence: null };
    return [id, rub] as const;
  });
  const signals = Object.fromEntries([...detEntries, ...rubEntries]) as Record<
    SignalId,
    SignalResult
  >;
  const lenses = Object.fromEntries(
    LENSES.map((lens) => [lens, { lens, score: 80, capped: false } satisfies LensScore]),
  ) as Record<Lens, LensScore>;
  return {
    lenses,
    signals,
    rubricVersion: "rubric-test",
    signalsVersion: "signals-test",
    modelId: "test-model",
  };
}

const DOCUMENT: WorkbenchDocument = {
  id: "doc-1",
  title: "Pour-Over Basics: A Guide!",
  source: "paste",
  sourceUrl: null,
  rawContent: RAW_DOC,
  wordCount: 20,
};

const AUDIT: WorkbenchAudit = {
  id: "audit-1",
  status: "completed",
  scoresStatus: "done",
  rewritesStatus: "done",
  scores: makeBreakdown(),
  findings: {
    questionGaps: [],
    anchorSuggestions: [],
    blockers: [],
    qaPairs: [{ question: "What grind?", answer: "Medium-fine." }],
    quotables: [],
  },
  rewrites: { hunks: [HUNK] },
  modelId: "test-model",
  createdAt: "2026-07-11T00:00:00.000Z",
};

describe("buildWorkbenchExportBundle", () => {
  it("exports the WORKING content, preserving manual editor edits", () => {
    const workingContent = RAW_DOC.replace("medium-fine grind", "hand-tuned grind");
    const bundle = buildWorkbenchExportBundle({
      document: DOCUMENT,
      audit: AUDIT,
      acceptedRewriteIds: [],
      workingContent,
    });
    expect(bundle.optimizedMarkdown).toBe(workingContent);
  });

  it("applies accepted hunks that are not yet in the working content", () => {
    const bundle = buildWorkbenchExportBundle({
      document: DOCUMENT,
      audit: AUDIT,
      acceptedRewriteIds: [HUNK.id],
      workingContent: RAW_DOC,
    });
    expect(bundle.optimizedMarkdown).toContain(HUNK.after);
    expect(bundle.optimizedMarkdown).not.toContain(HUNK.before);
  });

  it("does not double-apply a hunk the workbench already applied to the working content", () => {
    // The workbench applies accepted hunks to `content` on accept, so the
    // working copy usually already contains `after`; the id being passed too
    // must be a no-op (before-text is gone → hunk skipped).
    const alreadyApplied = RAW_DOC.replace(HUNK.before, HUNK.after);
    const bundle = buildWorkbenchExportBundle({
      document: DOCUMENT,
      audit: AUDIT,
      acceptedRewriteIds: [HUNK.id],
      workingContent: alreadyApplied,
    });
    expect(bundle.optimizedMarkdown).toBe(alreadyApplied);
  });

  it("assembles all five export surfaces (md, html+JSON-LD, JSON-LD, roadmap, scores)", () => {
    const bundle = buildWorkbenchExportBundle({
      document: DOCUMENT,
      audit: AUDIT,
      acceptedRewriteIds: [HUNK.id],
      workingContent: RAW_DOC,
    });
    expect(bundle.optimizedHtml).toContain('<script type="application/ld+json">');
    expect(bundle.jsonLd).toContain('"@type": "FAQPage"');
    expect(bundle.roadmapMarkdown).toContain("# Optimization Roadmap");
    expect(JSON.parse(bundle.scoresJson)).toEqual(AUDIT.scores);
  });
});

describe("exportFilesFor", () => {
  it("names files from the slugified document title with the right mime types", () => {
    const bundle = buildWorkbenchExportBundle({
      document: DOCUMENT,
      audit: AUDIT,
      acceptedRewriteIds: [],
      workingContent: RAW_DOC,
    });
    const files = exportFilesFor(DOCUMENT.title, bundle);

    expect(files.markdown).toEqual({
      filename: "pour-over-basics-a-guide.md",
      mime: "text/markdown",
      content: bundle.optimizedMarkdown,
    });
    expect(files.html.filename).toBe("pour-over-basics-a-guide.html");
    expect(files.html.mime).toBe("text/html");
    expect(files.html.content).toBe(bundle.optimizedHtml);
    expect(files.roadmap.filename).toBe("pour-over-basics-a-guide-roadmap.md");
    expect(files.roadmap.content).toBe(bundle.roadmapMarkdown);
    expect(files.scores.filename).toBe("pour-over-basics-a-guide-scores.json");
    expect(files.scores.mime).toBe("application/json");
    expect(files.scores.content).toBe(bundle.scoresJson);
  });
});

describe("slugify", () => {
  it("kebab-cases and strips punctuation", () => {
    expect(slugify("Pour-Over Basics: A Guide!")).toBe("pour-over-basics-a-guide");
  });

  it("falls back when the title has no usable characters", () => {
    expect(slugify("???")).toBe("export");
    expect(slugify("")).toBe("export");
  });

  it("caps very long titles", () => {
    expect(slugify("word ".repeat(40)).length).toBeLessThanOrEqual(60);
  });
});
