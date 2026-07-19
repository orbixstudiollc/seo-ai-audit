import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { e2eMockModel } from "./testModel";

/**
 * Server-key model construction. v1 is anonymous and stateless: every audit
 * runs on a server-held key (Vercel env), never a user-supplied one — no
 * BYOK, no per-user key storage. The operator DOES get to choose which
 * provider that server key belongs to (Anthropic direct, an Anthropic-
 * compatible proxy, or any OpenAI-compatible endpoint — OpenRouter,
 * zenmuz.ai, Ollama, vLLM, LiteLLM, ...), configured entirely via env vars.
 */

/** `cheap` runs the RUB scoring call (call 1, consistency-optimized, temp 0);
 * `strong` runs the rewrite generator (call 2, quality-optimized). */
export type Tier = "cheap" | "strong";

const DEFAULT_ANTHROPIC_MODEL_IDS: Record<Tier, string> = {
  cheap: "claude-haiku-4-5-20251001",
  strong: "claude-haiku-4-5-20251001",
};

/** The default (no AI_MODEL override) model id a tier resolves to on the Anthropic path. */
export function serverModelId(tier: Tier): string {
  return DEFAULT_ANTHROPIC_MODEL_IDS[tier];
}

export type ProviderKind = "anthropic" | "openai-compatible";

/** The env vars provider resolution reads — narrower than `NodeJS.ProcessEnv` so tests can pass plain object literals. */
export interface ProviderEnv {
  AI_PROVIDER?: string;
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
}

export interface ResolvedProvider {
  kind: ProviderKind;
  apiKey: string;
  /** Unset on "anthropic" -> the real Anthropic API. Always set on "openai-compatible". */
  baseUrl?: string;
  /** Unset on "anthropic" -> the built-in per-tier ids below. Set -> used for BOTH tiers (a custom provider gets one model, not a cheap/strong split). */
  model?: string;
}

/**
 * Resolves which AI provider + credentials to use, env-first:
 *
 * 1. `AI_PROVIDER=openai-compatible` — requires `AI_API_KEY` + `AI_BASE_URL` +
 *    `AI_MODEL`. One code path (OpenAI SDK, classic chat/completions) covers
 *    OpenRouter, zenmuz.ai, Ollama's OpenAI-compat mode, vLLM, LiteLLM, and
 *    most other OpenAI-compatible proxies.
 * 2. `AI_PROVIDER=anthropic` — `AI_API_KEY` (falling back to
 *    `ANTHROPIC_API_KEY`), plus optional `AI_BASE_URL` (an Anthropic-
 *    compatible proxy) and `AI_MODEL` (defaults to the built-in per-tier ids
 *    when unset).
 * 3. No `AI_PROVIDER` set (or an unrecognized value) — falls back to exactly
 *    today's behavior: `ANTHROPIC_API_KEY` only, the real Anthropic API, the
 *    built-in per-tier model ids. Existing deployments configured with only
 *    `ANTHROPIC_API_KEY` are unaffected by this module.
 *
 * Returns `null` when nothing is configured — the caller's job (`buildServerModel`)
 * to degrade gracefully rather than crash the process.
 */
export function resolveProvider(env: ProviderEnv = process.env as ProviderEnv): ResolvedProvider | null {
  const kind = env.AI_PROVIDER;

  if (kind === "openai-compatible") {
    const apiKey = env.AI_API_KEY;
    const baseUrl = env.AI_BASE_URL;
    const model = env.AI_MODEL;
    if (!apiKey || !baseUrl || !model) return null;
    return { kind: "openai-compatible", apiKey, baseUrl, model };
  }

  if (kind === "anthropic") {
    const apiKey = env.AI_API_KEY ?? env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    return { kind: "anthropic", apiKey, baseUrl: env.AI_BASE_URL, model: env.AI_MODEL };
  }

  // No (or unrecognized) AI_PROVIDER — legacy path, byte-for-byte unchanged.
  const legacyKey = env.ANTHROPIC_API_KEY;
  if (!legacyKey) return null;
  return { kind: "anthropic", apiKey: legacyKey };
}

/**
 * Builds a `LanguageModel` for one pipeline tier from the resolved provider.
 * `experimental_telemetry` is deliberately never enabled by any caller of the
 * returned model — no tracing pipeline ever sees prompts or the key.
 */
export function buildServerModel(tier: Tier): LanguageModel {
  // ponytail: test/CI escape hatch. AUDIT_TEST_MOCK=1 is set only by the test
  // suite and the Playwright dev server, so the real provider path below is
  // unchanged in prod — this returns a deterministic offline model so tests
  // and e2e never spend a real key.
  if (process.env.AUDIT_TEST_MOCK === "1") {
    return e2eMockModel(tier);
  }

  const provider = resolveProvider();
  if (!provider) {
    throw new Error(
      "No AI provider is configured. Set ANTHROPIC_API_KEY, or AI_PROVIDER " +
        '("anthropic" | "openai-compatible") together with AI_API_KEY, AI_BASE_URL, and AI_MODEL.',
    );
  }

  if (provider.kind === "openai-compatible") {
    /**
     * `.chat(modelId)` targets the classic Chat Completions API, not
     * `createOpenAI(...)(modelId)`'s default (OpenAI's newer Responses API).
     * Nearly every third-party "OpenAI-compatible" proxy — OpenRouter,
     * zenmuz.ai, Ollama's OpenAI-compat mode, vLLM, LiteLLM — only
     * implements the classic route. Salvaged from the pre-pivot BYOK
     * provider (`backup/pre-rewrite:lib/audit/provider.ts`), which found
     * this the hard way against a live third-party endpoint.
     */
    return createOpenAI({ apiKey: provider.apiKey, baseURL: provider.baseUrl }).chat(provider.model!);
  }

  const modelId = provider.model ?? DEFAULT_ANTHROPIC_MODEL_IDS[tier];
  if (!provider.baseUrl) {
    return createAnthropic({ apiKey: provider.apiKey })(modelId);
  }
  /**
   * `@ai-sdk/anthropic`'s `createAnthropic({baseURL})` appends `/messages`
   * directly — it does NOT insert `/v1` itself. The real Anthropic API (and
   * essentially every Anthropic-compatible proxy) serves that route at
   * `/v1/messages`, so a bare host 404s unless `/v1` is appended here first.
   * Salvaged from the same pre-pivot provider module.
   */
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  return createAnthropic({ apiKey: provider.apiKey, baseURL: `${baseUrl}/v1` })(modelId);
}
