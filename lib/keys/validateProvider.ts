import { APICallError, generateText } from "ai";
import { buildCustomModel, modelIdFor, type CustomProviderConfig } from "@/lib/audit/provider";
import type { ApiKeyProvider } from "./types";

/**
 * Server-side BYOK key validation: prove a submitted key actually works before
 * we encrypt and store it. The pure classification (classifyProviderResponse)
 * is split out from the network calls so the money/security branch is unit
 * testable without mocking fetch (see validateProvider.test.ts).
 */

export type ValidationOutcome =
  | { ok: true }
  | { ok: false; kind: "invalid" | "quota" | "rate_limited" | "provider_error" };

const VALIDATION_TIMEOUT_MS = 10_000;

const OPENAI_MODELS_URL = "https://api.openai.com/v1/models";
const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Anthropic has no free auth-only endpoint, so we spend one max_tokens:1 call
// (a fraction of a cent on the user's own key) to prove it works. Ping the
// same cheap-tier model audits actually use (lib/audit/provider.ts) so this
// never validates a key against a model family that could be retired while
// the audit path moves on — a single source of truth for "which model."
const ANTHROPIC_PING_MODEL = modelIdFor("anthropic", "cheap");

/**
 * Maps a provider HTTP status (+ optional machine error code) to a storage
 * decision. Pure — no I/O — so it can be exhaustively unit tested.
 *
 * - 2xx                       → valid, store it
 * - 401/403                   → the key is wrong; caller must NOT store it
 * - 429 + insufficient_quota  → real key, no credit; storable as "quota"
 * - 429 (anything else)       → transient rate limit; don't store, ask retry
 * - everything else           → generic provider error; don't store
 *
 * ponytail: Anthropic out-of-credit surfaces as a 400 with no clean machine
 * code, so it falls into "provider_error" rather than a distinct "quota".
 * Add a body-text sniff here only if that ambiguity actually bites users.
 */
export function classifyProviderResponse(
  status: number,
  errorCode: string | undefined,
): ValidationOutcome {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 401 || status === 403) return { ok: false, kind: "invalid" };
  if (status === 429) {
    if (errorCode === "insufficient_quota") return { ok: false, kind: "quota" };
    return { ok: false, kind: "rate_limited" };
  }
  return { ok: false, kind: "provider_error" };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Reads ONLY the machine-readable error code/type. The human-readable message
// (which can echo request config and thus key-adjacent data) is discarded so
// nothing key-derived is ever surfaced to the client or logs.
async function readErrorCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: { code?: string; type?: string } };
    return body.error?.code ?? body.error?.type;
  } catch {
    return undefined;
  }
}

async function validateOpenAi(apiKey: string): Promise<ValidationOutcome> {
  const res = await fetchWithTimeout(OPENAI_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return classifyProviderResponse(res.status, res.ok ? undefined : await readErrorCode(res));
}

async function validateAnthropic(apiKey: string): Promise<ValidationOutcome> {
  const res = await fetchWithTimeout(ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_PING_MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  return classifyProviderResponse(res.status, res.ok ? undefined : await readErrorCode(res));
}

// Mirrors readErrorCode's exact contract above (code, falling back to type) —
// classifyProviderResponse does an exact `=== "insufficient_quota"` match,
// NOT the fuzzy substring match lib/audit/errors.ts's mapProviderError does
// for its own (differently-shaped) looksLikeQuota check. Reads only the same
// key-free primitives (status code + one machine error-code token) as every
// other path here — never the raw error, its cause, or request config.
function codeTokenOfApiCallError(err: APICallError): string | undefined {
  const data: unknown = err.data;
  if (typeof data !== "object" || data === null) return undefined;
  const inner: unknown = (data as { error?: unknown }).error;
  if (typeof inner !== "object" || inner === null) return undefined;
  const bag = inner as { code?: unknown; type?: unknown };
  if (typeof bag.code === "string") return bag.code;
  if (typeof bag.type === "string") return bag.type;
  return undefined;
}

/**
 * Validates a custom (arbitrary OpenAI/Anthropic-compatible) endpoint by
 * actually constructing the exact model `buildByokModel` would build (via the
 * shared `buildCustomModel` — same request-path fixups, so a config that
 * validates here is guaranteed to hit the same URL a real audit will) and
 * spending one minimal real call on it — this is the only way to prove a
 * third-party endpoint's specific base URL + model id combination actually
 * works, since there's no fixed "list models" convention to rely on across
 * arbitrary proxies the way there is for the two named providers.
 *
 * ponytail: a 2xx response the AI SDK can't parse (a proxy that's only
 * roughly OpenAI/Anthropic-compatible) throws a plain TypeError, not an
 * APICallError, so it falls into the same "network" bucket as a real
 * connectivity failure below — safe (the key is never stored on an
 * unconfirmed endpoint) but the resulting message says "couldn't reach"
 * for what's actually "reached it, couldn't understand the reply." Add a
 * distinct outcome/message for that case only if real custom endpoints
 * actually hit it.
 */
async function validateCustom(
  apiKey: string,
  custom: CustomProviderConfig,
): Promise<ValidationOutcome> {
  const model = buildCustomModel(apiKey, custom, custom.cheapModel);

  try {
    await generateText({
      model,
      prompt: "ping",
      maxOutputTokens: 1,
      // A validation ping is a single deterministic check, not a completion
      // worth the AI SDK's default retry/backoff (maxRetries: 2) — that would
      // turn one 429 into a multi-second wait for what a plain fetch-based
      // check (validateOpenAi/validateAnthropic above) reports instantly.
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
    });
    return { ok: true };
  } catch (err) {
    // Only an APICallError (a real HTTP response from the endpoint) is
    // classifiable — anything else (DNS failure, connection refused, timeout)
    // is a network-class failure and rethrows, matching validateProviderKey's
    // "throws only on network/timeout failure" contract for the other two
    // providers.
    if (!APICallError.isInstance(err)) throw err;
    const status = err.statusCode ?? 0;
    return classifyProviderResponse(status, codeTokenOfApiCallError(err));
  }
}

/**
 * Validates a BYOK key against its provider. Rejects (throws) only on a
 * network/timeout failure — every HTTP response resolves to a ValidationOutcome.
 */
export function validateProviderKey(
  provider: ApiKeyProvider,
  apiKey: string,
  custom?: CustomProviderConfig,
): Promise<ValidationOutcome> {
  if (provider === "custom") {
    if (!custom) throw new Error("validateProviderKey(\"custom\", ...) requires a CustomProviderConfig.");
    return validateCustom(apiKey, custom);
  }
  return provider === "openai" ? validateOpenAi(apiKey) : validateAnthropic(apiKey);
}
