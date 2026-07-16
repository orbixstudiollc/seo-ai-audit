import { APICallError } from "ai";
import type { ImportError } from "@/lib/import";
import type { AuditErrorKind } from "./types";

/**
 * The single choke point that turns a raw LLM SDK error into a typed,
 * key-safe shape. Nothing else in lib/audit/* or app/api/audit/* is allowed
 * to inspect or forward a raw provider error.
 *
 * NEVER-LOG DISCIPLINE: a raw AI SDK error carries `.cause`, `.responseBody`,
 * `.requestBodyValues`, `.url` — request config that can embed the server's
 * Authorization header. This module reads ONLY two provider-agnostic, key-free
 * primitives off the error (numeric `statusCode` and the `retry-after`
 * response header) and returns an authored message. It never returns,
 * re-throws, logs, or nests the original error object.
 *
 * v1 runs a single server-side Anthropic key (no BYOK, no per-user auth/quota
 * to report), so every non-rate-limit failure collapses to the wire's generic
 * "server" kind — there is no user-owned key or billing state to explain.
 */

export type LlmErrorKind = "rate_limit" | "server";

export interface LlmError {
  kind: LlmErrorKind;
  /** Present when the provider told us how long to wait. */
  retryAfterSec?: number;
  /** Authored by us — safe to show a user and safe to log. Never the provider's raw message. */
  userMessage: string;
}

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

export function mapLlmError(err: unknown): LlmError {
  const status = statusOf(err);

  if (status === 429) {
    const retryAfterSec = retryAfterOf(err);
    return {
      kind: "rate_limit",
      retryAfterSec,
      userMessage: retryAfterSec
        ? `The audit service is busy right now. Retry in ${retryAfterSec}s.`
        : "The audit service is busy right now. Wait a moment and retry.",
    };
  }

  return {
    kind: "server",
    userMessage: "The audit failed due to an unexpected error. Try again in a moment.",
  };
}

/**
 * Maps a `lib/import` fetch/extract failure to the wire's `AuditErrorKind`.
 * Per DATA-CONTRACT §2: `fetch_failed` covers network errors, non-2xx,
 * timeouts, and SSRF blocks; `unsupported_content` covers non-HTML, unusable
 * extraction, and oversized responses.
 */
export function mapImportError(err: ImportError): { kind: AuditErrorKind; message: string } {
  const kind: AuditErrorKind =
    err.kind === "too_large" || err.kind === "not_html" ? "unsupported_content" : "fetch_failed";
  return { kind, message: err.message };
}
