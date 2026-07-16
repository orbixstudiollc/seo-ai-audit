import {
  applyHardCaps,
  computeLensScore,
  computeParsedDocument,
  DET_SIGNALS,
  DET_SIGNAL_IDS,
  LENSES,
  type DetSignalId,
  type DetSignalResult,
  type Lens,
  type LensScore,
  type RubSignalId,
  type RubSignalResult,
  type ScoreBreakdown,
  type SignalId,
  type SignalResult,
} from "@aeo/scoring";
import type { AuditFindings, AuditRewrites } from "./types";

/**
 * DATA-CONTRACT v1 shapes WS2 hasn't landed yet on this branch (lib/audit/types.ts
 * still carries the pre-pivot BYOK shape: `done` with an auditId, no `meta`
 * event, the old no_key/invalid_key/... error kinds). These four types are the
 * exact v1 contract from docs/DATA-CONTRACT.md §2 — WS3 (this hook + the mock
 * report) builds against them now.
 *
 * contract-v1: moves to lib/audit/types.ts at merge (replaces the BYOK shapes).
 */
export interface PageMeta {
  url: string;
  finalUrl: string;
  title: string;
  wordCount: number;
  fetchedAt: string;
}

// contract-v1: moves to lib/audit/types.ts at merge (replaces the BYOK error kind set).
export type AuditErrorKind =
  | "invalid_url"
  | "fetch_failed"
  | "unsupported_content"
  | "rate_limit"
  | "server";

// contract-v1: moves to lib/audit/types.ts at merge.
export type AuditStreamEvent =
  | { type: "meta"; page: PageMeta }
  | { type: "signals"; signals: Record<DetSignalId, DetSignalResult> }
  | { type: "scores"; scores: ScoreBreakdown; findings: AuditFindings }
  | { type: "rewrites"; rewrites: AuditRewrites }
  | { type: "done" }
  | { type: "error"; kind: AuditErrorKind; message: string; retryAfter?: number };

// contract-v1: moves to lib/audit/types.ts at merge — what the results page holds once the stream completes.
export interface AuditReport {
  page: PageMeta;
  scores: ScoreBreakdown;
  findings: AuditFindings;
  rewrites: AuditRewrites | null;
}

/**
 * A complete, internally-consistent `AuditReport` for `/dev/mock-report` and
 * component/unit tests, built before WS2's `/api/audit` exists.
 *
 * The article is `05-mediocre-a.md` from the scoring fixtures (a real, if
 * mediocre, explainer on backlinks — generic "Introduction"/"Conclusion"
 * headings, no direct answer before the first H2, no stats). Its S1
 * (answer-first intro) genuinely scores 0 — there's no paragraph in the H1's
 * own section — which is real enough to trip the engine's AI Overview hard
 * cap, so the mock exercises the capped-lens UI (badge + reason banner) with
 * a real cap, not a fabricated one.
 *
 * The 11 DET signals (S1-S11) run through the REAL engine
 * (`computeParsedDocument` + `DET_SIGNALS`) against that text, so their
 * `detail` values are genuine measurements, not hand-typed numbers. S12-S18
 * (RUB) are hand-authored, standing in for the LLM rubric call, grounded in
 * the same article's actual content. Lens scores and hard caps are then
 * derived from all 18 signals via the engine's own `computeLensScore` /
 * `applyHardCaps` — the exact math the server pipeline uses — so no lens
 * number here can drift from real weighting.
 */
const ARTICLE_MARKDOWN = `# Understanding Backlinks in SEO

## Introduction

In the world of search engine optimization, there are many different ranking factors that websites need to think about, and backlinks are often described as one of the most important ones out of all of them. This has been true for a long time now, going back to the late 1990s when Google's algorithm first started using them, and it continues to matter quite a bit even as the search landscape keeps changing around it every year. Understanding what backlinks are and why they carry the weight they do can help site owners make better decisions about where to spend their limited time.

## Backlinks, Defined Simply

A backlink is basically a link from one website pointing over to another website, and search engines have historically treated these links as a kind of vote of confidence between sites. If a lot of other sites are linking to your page, the thinking goes, then your page is probably worth linking to, which in turn suggests it might be worth ranking higher than pages that nobody else bothers to link to at all. This idea traces back to how academic citations work, where a paper that gets cited by many other papers is generally assumed to carry more authority than one that never gets referenced by anyone else in the field, and Google borrowed quite a bit of that thinking when it built its original ranking system, according to search engineers who have written about the company's early history.

## Backlink Impact on Search Rankings

It matters because search engines are still trying to figure out which pages to trust, and links from other websites remain one of the signals they lean on to make that call, even though the exact way they weigh it has changed over the years and continues to shift as algorithms get updated. Not every link counts the same amount, and a link from a well-established, trustworthy site is generally treated as worth more than a link from a brand new or low-quality site that doesn't have much of a track record behind it yet.

## Different Kinds of Links You'll Come Across

There are a few different categories worth knowing about, including editorial links that other writers add naturally because they found your content useful, guest post links that come from writing for other publications, and directory links that come from being listed in some kind of business or resource directory somewhere online. Each type tends to carry different weight, and building a healthy mix rather than relying on just one kind is usually the safer long-term approach for a site that wants to avoid looking manipulative to search engines over time.

## Conclusion

Backlinks remain a meaningful part of how search engines decide what to rank, even if they're no longer the only thing that matters the way they might have been years ago. Site owners who want to build authority over time should keep earning them steadily rather than chasing shortcuts.
`;

const parsedDoc = computeParsedDocument(ARTICLE_MARKDOWN, false);

const detSignals = Object.fromEntries(
  DET_SIGNAL_IDS.map((id) => [id, DET_SIGNALS[id](parsedDoc)] as const),
) as Record<DetSignalId, DetSignalResult>;

const rubSignals: Record<RubSignalId, RubSignalResult> = {
  S12: {
    id: "S12",
    score: 30,
    evidence: null,
  },
  S13: {
    id: "S13",
    score: 55,
    evidence: "Understanding what backlinks are and why they carry the weight they do can help site owners make better decisions.",
  },
  S14: {
    id: "S14",
    score: 35,
    evidence:
      "Google borrowed quite a bit of that thinking when it built its original ranking system, according to search engineers who have written about the company's early history.",
  },
  S15: {
    id: "S15",
    score: 45,
    evidence:
      "building a healthy mix rather than relying on just one kind is usually the safer long-term approach for a site that wants to avoid looking manipulative to search engines over time.",
  },
  S16: {
    id: "S16",
    score: 70,
    evidence:
      "A backlink is basically a link from one website pointing over to another website, and search engines have historically treated these links as a kind of vote of confidence between sites.",
  },
  S17: {
    id: "S17",
    score: 30,
    evidence: null,
  },
  S18: {
    id: "S18",
    score: 20,
    evidence: null,
  },
};

const signals = { ...detSignals, ...rubSignals } as Record<SignalId, SignalResult>;

const rawLenses = Object.fromEntries(
  LENSES.map((lens) => [lens, computeLensScore(lens, signals)]),
) as Record<Lens, LensScore>;

const lenses = applyHardCaps(rawLenses, signals);

const scores: ScoreBreakdown = {
  lenses,
  signals,
  rubricVersion: "rubric-v3",
  signalsVersion: "signals-v2",
  modelId: "mock-model",
};

const findings: AuditFindings = {
  questionGaps: ["How many backlinks does a site actually need to rank?"],
  anchorSuggestions: [
    {
      claim:
        "Google borrowed quite a bit of that thinking when it built its original ranking system, according to search engineers who have written about the company's early history.",
      suggestedSourceType: "a named source or a Google/Moz publication",
    },
  ],
  blockers: [
    {
      issue:
        "No paragraph directly answers \"what is a backlink\" before the first H2 heading — the definition only appears two headings in.",
      location: "Introduction section",
    },
  ],
  qaPairs: [
    {
      question: "What is a backlink?",
      answer:
        "A backlink is a link from one website pointing to another, treated by search engines as a kind of vote of confidence between sites.",
    },
  ],
  quotables: [
    "A backlink is basically a link from one website pointing over to another website.",
    "Not every link counts the same amount.",
  ],
};

const rewrites: AuditRewrites = {
  hunks: [
    {
      id: "h1",
      kind: "intro",
      label: "Answer-first intro",
      before:
        "In the world of search engine optimization, there are many different ranking factors that websites need to think about, and backlinks are often described as one of the most important ones out of all of them.",
      after:
        "A backlink is a link from another site pointing to yours — search engines read it as a vote of confidence, and it's been one of the strongest ranking factors since Google's earliest algorithms.",
      targetSignal: "S1",
    },
    {
      id: "h2",
      kind: "section",
      label: "Tighten the backlink definition",
      before:
        "A backlink is basically a link from one website pointing over to another website, and search engines have historically treated these links as a kind of vote of confidence between sites.",
      after:
        "A backlink is a link from one site to another. Search engines treat it as a vote of confidence: more (and stronger) backlinks generally mean more trust.",
      targetSignal: "S16",
    },
    {
      id: "h3",
      kind: "quotable",
      label: "Name the source",
      before:
        "Google borrowed quite a bit of that thinking when it built its original ranking system, according to search engineers who have written about the company's early history.",
      after: "Google's original PageRank algorithm, published in 1998, formalized backlinks as a trust signal.",
      targetSignal: "S14",
    },
  ],
};

const page: PageMeta = {
  url: "https://example.com/understanding-backlinks-in-seo",
  finalUrl: "https://example.com/understanding-backlinks-in-seo",
  title: "Understanding Backlinks in SEO",
  wordCount: parsedDoc.wordCount,
  fetchedAt: "2026-07-17T09:15:00.000Z",
};

export const mockReport: AuditReport = { page, scores, findings, rewrites };
