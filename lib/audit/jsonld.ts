import type { QaPair } from "./types";

/**
 * Templated FAQ JSON-LD from call 1's extracted Q/A pairs — schema markup is
 * generated in code, never by an LLM call (per the plan). Returns a
 * pretty-printed string ready for the copy-paste block, or null when there
 * are no Q/A pairs to template.
 */
export function buildFaqJsonLd(qaPairs: QaPair[]): string | null {
  const pairs = qaPairs.filter((p) => p.question.trim() && p.answer.trim());
  if (pairs.length === 0) return null;

  const doc = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pairs.map((p) => ({
      "@type": "Question",
      name: p.question.trim(),
      acceptedAnswer: {
        "@type": "Answer",
        text: p.answer.trim(),
      },
    })),
  };

  return JSON.stringify(doc, null, 2);
}
