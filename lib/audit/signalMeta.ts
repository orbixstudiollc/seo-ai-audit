import {
  DET_SIGNAL_IDS,
  RUB_SIGNAL_IDS,
  type DetSignalResult,
  type Lens,
  type RubSignalResult,
  type SignalId,
  type SignalResult,
} from "@aeo/scoring";

/**
 * Presentation metadata for the 18 signals and 4 lenses. The engine ships
 * ids and numbers only; the human-readable labels/blurbs that power the
 * "why you scored 61" breakdown live here in the app layer.
 */

export type SignalClass = "DET" | "RUB";

export interface SignalMeta {
  label: string;
  blurb: string;
  cls: SignalClass;
}

export const SIGNAL_META: Record<SignalId, SignalMeta> = {
  S1: { label: "Answer-first intro", cls: "DET", blurb: "Opens with the answer in ≤3 sentences / ≤75 words, no fluff opener." },
  S2: { label: "Snippet-ready blocks", cls: "DET", blurb: "Share of H2/H3 sections opening with a 40–60-word extractable paragraph." },
  S3: { label: "Question-heading coverage", cls: "DET", blurb: "Share of headings phrased as the questions people actually ask." },
  S4: { label: "Passage chunkability", cls: "DET", blurb: "Sections sit in the 100–300-word band with no >400-word walls." },
  S5: { label: "Sentence stats", cls: "DET", blurb: "Average length, share of short sentences, and readability (voice-search proxy)." },
  S6: { label: "List / table density", cls: "DET", blurb: "Extractable lists and tables per 1,000 words." },
  S7: { label: "Schema presence", cls: "DET", blurb: "JSON-LD structured data detected in the source." },
  S8: { label: "Stat / fact density", cls: "DET", blurb: "Numbers, percentages, and units per 100 words — the raw material for citation." },
  S9: { label: "Citation density", cls: "DET", blurb: "External links and “according to X” attributions." },
  S10: { label: "Quotable-sentence rate", cls: "DET", blurb: "Self-contained 8–30-word sentences an LLM can lift verbatim." },
  S11: { label: "Section self-containedness", cls: "DET", blurb: "Sections that stand alone — no leading pronouns, no generic headings." },
  S12: { label: "Answer directness", cls: "RUB", blurb: "Does each question-section answer its question in the first sentence?" },
  S13: { label: "Question gap coverage", cls: "RUB", blurb: "Completeness against the questions a searcher expects answered." },
  S14: { label: "Claim verifiability", cls: "RUB", blurb: "Are claims sourced, checkable, and hallucination-safe?" },
  S15: { label: "Information uniqueness", cls: "RUB", blurb: "Original insight and data vs. commodity paraphrase." },
  S16: { label: "Definitional clarity", cls: "RUB", blurb: "Entities and terms defined unambiguously enough to lift as an answer." },
  S17: { label: "E-E-A-T", cls: "RUB", blurb: "Experience, expertise, authoritativeness, and trust markers in the text." },
  S18: { label: "AI Overview blockers", cls: "RUB", blurb: "Inverted: a high score means few/no things block a citation." },
};

export interface LensMeta {
  /** Short mono badge, e.g. "AEO". */
  code: string;
  /** Full name for headers. */
  name: string;
  blurb: string;
}

export const LENS_META: Record<Lens, LensMeta> = {
  aeo: { code: "AEO", name: "Answer Engine", blurb: "Featured snippets and direct-answer surfaces." },
  geo: { code: "GEO", name: "Generative Engine", blurb: "Getting cited inside ChatGPT, Perplexity, and Gemini answers." },
  citability: { code: "CIT", name: "Citability", blurb: "How liftable and sourceable your claims are." },
  aiOverview: { code: "AIO", name: "AI Overview", blurb: "Eligibility for Google's AI Overview box." },
};

export const LENS_ORDER: readonly Lens[] = ["aeo", "geo", "citability", "aiOverview"];

/** The E-E-A-T signal surfaced by the dedicated strip. */
export const EEAT_SIGNAL: SignalId = "S17";

export const EEAT_PILLARS = ["Experience", "Expertise", "Authoritativeness", "Trust"] as const;

// --- Runtime narrowing (SignalResult is a DET|RUB union) --------------------

const RUB_SET = new Set<SignalId>(RUB_SIGNAL_IDS);
const DET_SET = new Set<SignalId>(DET_SIGNAL_IDS);

export function isRubResult(r: SignalResult): r is RubSignalResult {
  return RUB_SET.has(r.id);
}

export function isDetResult(r: SignalResult): r is DetSignalResult {
  return DET_SET.has(r.id);
}
