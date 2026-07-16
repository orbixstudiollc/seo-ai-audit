import { APICallError } from "ai";
import type { Provider } from "./provider";

/**
 * The single choke point that turns any raw provider/SDK error into a typed,
 * key-safe shape. NOTHING else in lib/audit/* or app/api/audit/* is allowed to
 * inspect or forward a raw provider error.
 *
 * NEVER-LOG DISCIPLINE (plan "BYOK security" + synthesis #10): a raw AI SDK
 * error carries `.cause`, `.responseBody`, `.requestBodyValues`, `.url`, and
 * (transitively) request config that can embed the Authorization header — i.e.
 * the user's raw key. So this module reads ONLY two provider-agnostic, key-free
 * primitives off the error (numeric `statusCode` and the `retry-after` response
 * header) and returns an authored message. It never returns, re-throws, logs,
 * or nests the original error object.
 */

export type AuditErrorKind =
  | "rate_limit"
  | "auth"
  | "quota"
  | "invalid_request"
  | "server"
  | "unknown";

export interface AuditError {
  provider: Provider;
  kind: AuditErrorKind;
  /** Present for rate_limit / transient server errors when the provider told us. */
  retryAfterSec?: number;
  /** Authored by us — safe to show a user and safe to log. Never the provider's raw message. */
  userMessage: string;
}

/**
 * A log-safe projection of an unknown error: constructor name + numeric status
 * only. Strips the cause chain and every free-text / config field so a logger
 * physically cannot receive key material through it. Use this — never the raw
 * error — if a log line about a failure is ever needed.
 */
export interface LogSafeError {
  name: string;
  statusCode: number | null;
}

export function stripCause(err: unknown): LogSafeError {
  const name = err instanceof Error ? err.constructor.name : "UnknownError";
  const statusCode =
    APICallError.isInstance(err) && typeof err.statusCode === "number" ? err.statusCode : null;
  return { name, statusCode };
}

// Every message template below composes this as either "Your ${label} ..." or
// "${label} ..." — "Custom provider" (not "your custom provider") is the one
// phrasing that reads correctly in both without restructuring every template
// per-provider just for the one that has no proper-noun name to substitute.
const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  custom: "Custom provider",
};

function statusOf(err: unknown): number | null {
  return APICallError.isInstance(err) && typeof err.statusCode === "number" ? err.statusCode : null;
}

function retryAfterOf(err: unknown): number | undefined {
  if (!APICallError.isInstance(err)) return undefined;
  const header = err.responseHeaders?.["retry-after"];
  if (!header) return undefined;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/**
 * Reads a short classification token (e.g. "insufficient_quota") from the
 * error's structured `data`, if present. A code token is a fixed enum-ish
 * string, not free text and never key material — safe to branch on. Everything
 * is defensively narrowed since `data` is typed `unknown`.
 */
function codeTokenOf(err: unknown): string {
  if (!APICallError.isInstance(err)) return "";
  const data: unknown = err.data;
  if (typeof data !== "object" || data === null) return "";
  const inner: unknown = (data as { error?: unknown }).error;
  if (typeof inner !== "object" || inner === null) return "";
  const bag = inner as { code?: unknown; type?: unknown };
  const code = typeof bag.code === "string" ? bag.code : "";
  const type = typeof bag.type === "string" ? bag.type : "";
  return `${code} ${type}`.toLowerCase();
}

const QUOTA_HINTS = ["quota", "insufficient", "billing", "credit"];

function looksLikeQuota(err: unknown): boolean {
  const token = codeTokenOf(err);
  return QUOTA_HINTS.some((hint) => token.includes(hint));
}

export function mapProviderError(err: unknown, provider: Provider): AuditError {
  const label = PROVIDER_LABEL[provider];
  const status = statusOf(err);
  const retryAfterSec = retryAfterOf(err);

  if (status === 401 || status === 403) {
    return {
      provider,
      kind: "auth",
      userMessage: `Your ${label} API key was rejected (authentication failed). Update it in Settings and try again.`,
    };
  }

  if (status === 402 || (status === 429 && looksLikeQuota(err))) {
    return {
      provider,
      kind: "quota",
      userMessage: `Your ${label} account is out of quota or credits. Add credits or check billing, then re-run the audit.`,
    };
  }

  if (status === 429) {
    const wait = retryAfterSec ? ` Retry in ${retryAfterSec}s.` : " Wait a moment and retry.";
    return {
      provider,
      kind: "rate_limit",
      retryAfterSec,
      userMessage: `Your ${label} key is rate-limited.${wait}`,
    };
  }

  if (status === 400 || status === 422) {
    return {
      provider,
      kind: "invalid_request",
      userMessage: `${label} rejected the audit request as invalid. This is usually a transient model issue — try again.`,
    };
  }

  if (status !== null && status >= 500) {
    return {
      provider,
      kind: "server",
      retryAfterSec,
      userMessage: `${label} had a server error. Try again in a moment.`,
    };
  }

  return {
    provider,
    kind: "unknown",
    userMessage: `The audit failed due to an unexpected error talking to ${label}. Try again; if it persists, check your key in Settings.`,
  };
}
