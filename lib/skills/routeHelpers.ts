import { z } from "zod";
import { checkRateLimit } from "@/lib/audit/ratelimit";
import { clientIp } from "@/lib/audit/httpHelpers";
import { cloudHistoryConfigured, resolveOwnerHashFromRequest } from "@/lib/cloud/server";
import { ImportError } from "@/lib/import";
import type { SkillErrorKind, SkillId, SkillScope, SkillTask } from "./types";

/**
 * Shared plumbing for every `app/api/skills/<skillId>/route.ts` (DATA-CONTRACT
 * §8). All five deterministic skills are free ($0, no persistence) — the
 * whole request completes inline, so this only needs the gate + envelope
 * constructors, never a taskStore.
 */

/** `Response.json` with the no-store header every skill route uses. */
export function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const scopeBodySchema = z.object({
  scope: z.object({
    kind: z.enum(["page", "site"]),
    url: z.string().url().max(2048),
  }),
});

/** A scope that has passed body validation — `url` is guaranteed present. */
export interface ValidatedScope extends SkillScope {
  kind: "page" | "site";
  url: string;
}

/**
 * Rate limit -> owner resolve -> body validate, in that order (mirrors
 * app/api/tracked-sites/route.ts's POST gate). Returns the validated scope
 * plus owner hash on success, or the terminal Response on the first gate
 * that fails.
 */
export async function skillGate(
  request: Request,
  skillId: SkillId,
  perMin: number,
): Promise<{ ownerHash: string; scope: ValidatedScope } | Response> {
  const ip = clientIp(request);
  const minute = checkRateLimit(`skills:${skillId}:ip:min:${ip}`, perMin, 60);
  if (!minute.allowed) return json(429, { error: "rate_limit", retryAfter: minute.retryAfterSec });

  if (!cloudHistoryConfigured()) return json(503, { error: "cloud_unavailable" });
  const ownerHash = await resolveOwnerHashFromRequest(request);
  if (ownerHash === null) return json(401, { error: "invalid_owner" });

  const parsed = scopeBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_scope" });
  const { kind, url } = parsed.data.scope;
  const target = new URL(url); // shape already checked by zod .url()
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return json(400, { error: "invalid_scope" });
  }
  return { ownerHash, scope: { kind, url } };
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Builds a `complete` SkillTask envelope for an inline, $0 skill run. */
export function completeTask<T>(
  skillId: SkillId,
  scope: SkillScope,
  result: T,
  resultVersion: number,
): SkillTask<T> {
  const timestamp = nowIso();
  return {
    id: crypto.randomUUID(),
    skillId,
    scope,
    status: "complete",
    createdAt: timestamp,
    updatedAt: timestamp,
    costUsd: 0,
    resultVersion,
    result,
  };
}

/** Builds a `failed` SkillTask envelope. The §8 envelope carries the failure
 * (HTTP 200); only gate rejections (rate limit, invalid owner, bad body) use
 * a non-200 status. */
export function failedTask(
  skillId: SkillId,
  scope: SkillScope,
  kind: SkillErrorKind,
  message: string,
): SkillTask<null> {
  const timestamp = nowIso();
  return {
    id: crypto.randomUUID(),
    skillId,
    scope,
    status: "failed",
    createdAt: timestamp,
    updatedAt: timestamp,
    costUsd: 0,
    resultVersion: 1,
    result: null,
    error: { kind, message },
  };
}

/**
 * Classifies a run failure into a SkillErrorKind + user-facing message.
 * ImportError "blocked" (SSRF-guarded fetch refused the URL) is the caller's
 * fault -> invalid_input; "not_html"/"too_large" mean the content wasn't
 * something we could process -> unsupported_content (same grouping as
 * lib/audit/errors.ts's mapImportError); everything else (timeout,
 * fetch_failed) -> fetch_failed. Anything not an ImportError is an
 * unexpected bug in the module itself -> server.
 */
export function toSkillError(err: unknown): { kind: SkillErrorKind; message: string } {
  if (err instanceof ImportError) {
    const kind: SkillErrorKind =
      err.kind === "blocked"
        ? "invalid_input"
        : err.kind === "not_html" || err.kind === "too_large"
          ? "unsupported_content"
          : "fetch_failed";
    return { kind, message: err.message };
  }
  return { kind: "server", message: "Unexpected error." };
}

/** Every free skill is stateless (no persistence) — GET ?id= always 404s. */
export function taskNotFound(): Response {
  return json(404, { error: "task_not_found" });
}
