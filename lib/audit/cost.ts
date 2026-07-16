import type { ApiKeyProvider } from "./types";

/**
 * Client-safe pre-run cost estimate. This lives apart from
 * lib/audit/provider.ts (which re-exports it) because provider.ts imports the
 * AI SDK factories and must never be pulled into a client bundle just to
 * render "~$0.05". These anchors have exactly one home: here.
 */

/** The two named providers have a known per-word cost anchor; "custom" deliberately does not — see formatAuditCostEstimate. */
type NamedProvider = Exclude<ApiKeyProvider, "custom">;

// Plan cost anchors: a full 2-call audit of a ~1500-word article costs the user
// roughly this much on their own key. Scaled linearly by word count below.
const USD_PER_1500_WORDS: Record<NamedProvider, number> = {
  openai: 0.05,
  anthropic: 0.08,
};
const ANCHOR_WORD_COUNT = 1500;
// Floor so a tiny paste never displays a misleading "$0.00"; the two LLM calls
// always cost at least this in practice.
const MIN_ESTIMATE_USD = 0.01;

/**
 * Pre-run cost estimate (USD) shown before the user spends their own key.
 * Linear in word count off the plan anchors, floored at one cent, rounded to
 * cents. An estimate, not a quote — real cost depends on the article's exact
 * token shape and the provider's live pricing. Only meaningful for the two
 * named providers — a custom endpoint's pricing is unknowable, so it's typed
 * out of this function entirely rather than given a made-up anchor.
 */
export function estimateAuditCostUsd(wordCount: number, provider: NamedProvider): number {
  const words = Number.isFinite(wordCount) && wordCount > 0 ? wordCount : 0;
  const linear = (words / ANCHOR_WORD_COUNT) * USD_PER_1500_WORDS[provider];
  const floored = Math.max(MIN_ESTIMATE_USD, linear);
  return Math.round(floored * 100) / 100;
}

/**
 * Human-readable estimate label shared by the new-audit form and the
 * workbench Run/Re-score control. A known provider quotes that key; "custom"
 * has no fixed anchor to quote (pricing is whatever that endpoint charges),
 * so it gets an honest non-numeric message instead of a fabricated figure;
 * null (preference unset / SSR) shows the cross-provider range for the two
 * named providers.
 */
export function formatAuditCostEstimate(
  wordCount: number,
  provider: ApiKeyProvider | null,
): string {
  if (provider === "custom") {
    return "cost depends on your custom provider's pricing";
  }
  if (provider) {
    const name = provider === "openai" ? "OpenAI" : "Anthropic";
    return `~$${estimateAuditCostUsd(wordCount, provider).toFixed(2)} on your ${name} key`;
  }
  return `~$${estimateAuditCostUsd(wordCount, "openai").toFixed(2)}–$${estimateAuditCostUsd(wordCount, "anthropic").toFixed(2)} on your key`;
}
