import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { e2eMockModel } from "./testModel";

/**
 * BYOK provider construction. Every model here is built PER REQUEST from a
 * freshly decrypted key passed in as an argument — never from module-level
 * state, an env var, or a cached client. That is the whole security contract:
 * the plaintext key lives only inside the request scope that called this, and
 * the returned LanguageModel closes over it. Do not hoist the result.
 */

export type Provider = "openai" | "anthropic" | "custom";

/**
 * Tier maps to a concrete model id per provider. `cheap` runs the RUB scoring
 * call (call 1, consistency-optimized, temp 0); `strong` runs the rewrite
 * generator (call 2, quality-optimized). Ids are the plan's target tiers.
 */
export type Tier = "cheap" | "strong";

const MODEL_IDS: Record<"openai" | "anthropic", Record<Tier, string>> = {
  openai: { cheap: "gpt-5-mini", strong: "gpt-5" },
  anthropic: { cheap: "claude-haiku-4-5-20251001", strong: "claude-sonnet-5" },
};

/**
 * Custom-provider config: an arbitrary OpenAI- or Anthropic-compatible
 * endpoint (a proxy, reseller, or self-hosted gateway) with user-chosen model
 * ids, since a third-party endpoint's models can't live in MODEL_IDS above.
 *
 * ponytail: no SSRF/private-IP guard on `baseUrl`, unlike lib/import's
 * ssrfGuard — that guard exists because URL-import fetches an ARBITRARY
 * attacker-influenceable URL. This is the opposite trust boundary: the user
 * is deliberately pointing their OWN audits at their OWN chosen endpoint
 * (often a local model server or an internal gateway), which is the whole
 * point of the feature for a self-hosted tool. Revisit only if this app ever
 * grows a mode where one user's config can affect another user's requests.
 */
export interface CustomProviderConfig {
  baseUrl: string;
  apiFormat: "openai" | "anthropic";
  cheapModel: string;
  strongModel: string;
}

/**
 * The concrete model id a (provider, tier) resolves to. Needed up front — the
 * audit cache key / idempotency guard is keyed on model_id, which must be known
 * BEFORE the LLM call runs, so it can't wait for the SDK's post-response
 * `response.modelId`. This is the single source of truth both use.
 */
export function modelIdFor(
  provider: Provider,
  tier: Tier,
  custom?: CustomProviderConfig,
): string {
  if (provider === "custom") {
    if (!custom) throw new Error("modelIdFor(\"custom\", ...) requires a CustomProviderConfig.");
    return tier === "cheap" ? custom.cheapModel : custom.strongModel;
  }
  return MODEL_IDS[provider][tier];
}

/**
 * Builds a `LanguageModel` for a custom (arbitrary OpenAI/Anthropic-compatible)
 * endpoint. Shared by buildByokModel below and lib/keys/validateProvider.ts's
 * validateCustom, so the request-construction quirks below are fixed in
 * exactly one place — the two call sites drifting out of sync (one using a
 * fixed-up path, the other not) is exactly how a "this works" validation
 * could pass while the real audit call still 404s, or vice versa.
 *
 * Two real, empirically-verified quirks this works around (found by actually
 * calling a live third-party endpoint, not by reading the SDK's types):
 *
 * 1. `@ai-sdk/anthropic`'s `createAnthropic({baseURL})` appends `/messages`
 *    directly to whatever baseURL it's given — it does NOT insert `/v1`
 *    itself. The real Anthropic API (and essentially every Anthropic-
 *    compatible proxy) serves that route at `/v1/messages`, so a bare host
 *    (e.g. "https://api.example.com", the form users naturally type — it's
 *    also literally what this app's own settings field is labeled "API
 *    Endpoint" and asks for) 404s unless `/v1` is appended here first.
 * 2. `createOpenAI(...)` called directly (`createOpenAI(opts)(modelId)`)
 *    targets OpenAI's newer Responses API (`/responses`) by default. Nearly
 *    every third-party "OpenAI-compatible" proxy (LiteLLM, OpenRouter,
 *    Ollama's OpenAI-compat mode, vLLM, etc.) only implements the classic
 *    Chat Completions API — `.chat(modelId)` targets that explicitly.
 */
export function buildCustomModel(
  apiKey: string,
  custom: CustomProviderConfig,
  modelId: string,
): LanguageModel {
  const baseUrl = custom.baseUrl.replace(/\/+$/, "");
  if (custom.apiFormat === "openai") {
    return createOpenAI({ apiKey, baseURL: baseUrl }).chat(modelId);
  }
  return createAnthropic({ apiKey, baseURL: `${baseUrl}/v1` })(modelId);
}

/**
 * Builds a per-request `LanguageModel` from a decrypted BYOK key.
 *
 * `experimental_telemetry` is deliberately never enabled by any caller of the
 * returned model — leaving AI SDK telemetry off keeps BYOK-bearing prompts and
 * keys out of any tracing pipeline (synthesis amendment #10).
 */
export function buildByokModel(
  provider: Provider,
  apiKey: string,
  tier: Tier,
  custom?: CustomProviderConfig,
): LanguageModel {
  // ponytail: e2e-only escape hatch. AUDIT_TEST_MOCK=1 is set only by the
  // Playwright dev server, so the real BYOK path below is unchanged in prod —
  // this returns a deterministic offline model so the browser e2e never spends
  // a real key. Gated by env, not by build config, exactly as the task requires.
  if (process.env.AUDIT_TEST_MOCK === "1") {
    return e2eMockModel(tier);
  }
  if (provider === "custom") {
    if (!custom) {
      throw new Error("buildByokModel(\"custom\", ...) requires a CustomProviderConfig.");
    }
    const modelId = tier === "cheap" ? custom.cheapModel : custom.strongModel;
    return buildCustomModel(apiKey, custom, modelId);
  }
  const modelId = MODEL_IDS[provider][tier];
  if (provider === "openai") {
    return createOpenAI({ apiKey })(modelId);
  }
  return createAnthropic({ apiKey })(modelId);
}

// The client-safe cost estimate lives in ./cost (this module pulls in the AI
// SDK factories and must never reach a client bundle); re-exported so server
// callers keep one import site while the anchors have one home.
export { estimateAuditCostUsd } from "./cost";
