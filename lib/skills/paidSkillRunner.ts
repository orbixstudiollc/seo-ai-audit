import { createHash } from "node:crypto";
import { clientIp } from "@/lib/audit/httpHelpers";
import { checkRateLimit } from "@/lib/audit/ratelimit";
import { cloudHistoryConfigured, getSupabaseAdmin, resolveOwnerHashFromRequest } from "@/lib/cloud/server";
import { dataForSeoConfigured } from "@/lib/dataforseo";
import { cancelSpend, reserveSpend } from "@/lib/providers/budget";
import {
  latestTask,
  releaseReservation,
  reserveTask,
  type ProviderTaskRow,
  type TaskKey,
} from "@/lib/providers/taskStore";
import { failedTask } from "./routeHelpers";
import type { SkillErrorKind, SkillId, SkillScope, SkillTask, SkillTaskStatus } from "./types";

/**
 * F2-BUDGET / W1-DFS: the reserve -> call -> settle body shared by every paid
 * DataForSEO skill route (serp/keywords/labs/backlinks). Generalizes
 * app/api/technical-audit/route.ts's flow onto the §8 SkillTask envelope so
 * SK3's agent orchestrator can call this directly (no HTTP self-calls) when
 * it fans a skill out inline instead of handing it off.
 *
 * Every paid skill's DataForSEO "live" endpoint is synchronous (no task_post
 * + poll dance like on-page crawl) — the whole reserve/call/settle happens
 * inside one POST, so the only statuses this ever writes are "creating" then
 * "complete". Failures release the reservation rather than persisting a
 * "failed" row (nothing to resume by polling), matching the on-page route's
 * provider_start_failed handling.
 */

const RESULT_VERSION = 1;
const FINGERPRINT_PREFIX_LEN = 8;

export interface RunPaidSkillInput<TResult> {
  ownerHash: string;
  /** The owning audit_runs.id — provider_tasks.audit_id has an FK to it. */
  ledgerAuditId: string;
  skillId: SkillId;
  scope: SkillScope;
  /** Canonicalized (sha256'd) to build the per-call request_fingerprint. */
  fingerprintInput: unknown;
  estCostUsd: number;
  call: () => Promise<{ result: TResult; costUsd: number }>;
}

export interface RunPaidSkillOutput<TResult> {
  task: SkillTask<TResult>;
  reused: boolean;
}

/** One provider row per skillId. */
function providerFor(skillId: SkillId): string {
  return `dataforseo-${skillId}`;
}

/** Stable stringify (sorted object keys) so identical inputs always hash the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function fingerprintOf(input: unknown): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

const VALID_STATUSES: SkillTaskStatus[] = ["creating", "queued", "running", "complete", "failed"];

interface StoredResultMeta {
  costUsd?: number;
  resultVersion?: number;
  result?: unknown;
  errorKind?: SkillErrorKind;
  errorMessage?: string;
}

/**
 * Maps a persisted `provider_tasks` row back onto the §8 SkillTask envelope.
 * `expectedSkillId` is the calling route's own skill (taskStore's row shape
 * has no provider/skillId column to read back — `ProviderTaskRow` only
 * exposes `request`/`result_meta`, so the skillId this stamped at reserve
 * time travels inside `request.skillId` instead). Falls back to
 * `expectedSkillId` if the stored value is somehow missing.
 */
export function rowToSkillTask<TResult>(row: ProviderTaskRow, expectedSkillId: SkillId): SkillTask<TResult> {
  const meta = (row.result_meta ?? {}) as StoredResultMeta;
  const scope = (row.request?.scope as SkillScope | undefined) ?? { kind: "site" };
  const skillId = (row.request?.skillId as SkillId | undefined) ?? expectedSkillId;
  const status: SkillTaskStatus = VALID_STATUSES.includes(row.status as SkillTaskStatus)
    ? (row.status as SkillTaskStatus)
    : "creating";
  const task: SkillTask<TResult> = {
    id: row.id,
    skillId,
    scope,
    status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    costUsd: typeof meta.costUsd === "number" ? meta.costUsd : 0,
    resultVersion: typeof meta.resultVersion === "number" ? meta.resultVersion : RESULT_VERSION,
    result: status === "complete" ? ((meta.result as TResult | undefined) ?? null) : null,
  };
  if (status === "failed" && meta.errorMessage) {
    task.error = { kind: meta.errorKind ?? "server", message: meta.errorMessage };
  }
  return task;
}

/** Classifies a thrown provider-call error into a SkillErrorKind + message. */
function classifyCallError(err: unknown): { kind: SkillErrorKind; message: string } {
  const message = err instanceof Error && err.message ? err.message : "Unexpected error.";
  const kind: SkillErrorKind = /not configured/i.test(message) ? "provider_unavailable" : "fetch_failed";
  return { kind, message };
}

/** Best-effort settle of the actual cost in usage_ledger (mirrors ensureUsageLedger). */
async function settleLedger(
  ownerHash: string,
  ledgerAuditId: string,
  provider: string,
  operation: string,
  costUsd: number,
): Promise<void> {
  await getSupabaseAdmin().from("usage_ledger").upsert(
    { owner_hash: ownerHash, audit_id: ledgerAuditId, provider, operation, actual_cost_usd: costUsd, metadata: {} },
    { onConflict: "owner_hash,audit_id,provider,operation" },
  );
}

export async function runPaidSkill<TResult>(input: RunPaidSkillInput<TResult>): Promise<RunPaidSkillOutput<TResult>> {
  const provider = providerFor(input.skillId);
  const fingerprint = fingerprintOf(input.fingerprintInput);
  const key: TaskKey = { ownerHash: input.ownerHash, auditId: input.ledgerAuditId, provider, fingerprint };

  const existing = await latestTask(key);
  if (existing.row) return { task: rowToSkillTask<TResult>(existing.row, input.skillId), reused: true };

  const operation = `${input.skillId}_live:${fingerprint.slice(0, FINGERPRINT_PREFIX_LEN)}`;
  const spend = { ownerHash: input.ownerHash, auditId: input.ledgerAuditId, provider, operation, estCostUsd: input.estCostUsd };

  const budget = await reserveSpend(spend);
  if (!budget.allowed) {
    const task = failedTask(input.skillId, input.scope, "budget_exceeded", "Budget cap reached.") as SkillTask<TResult>;
    return { task, reused: false };
  }

  const reservation = await reserveTask(key, { scope: input.scope, skillId: input.skillId });
  if (reservation.error || !reservation.row) {
    // Unique-index collision: a concurrent identical request reserved first —
    // drop our budget reservation (theirs already counts) and reuse its task.
    await cancelSpend(spend);
    const concurrent = await latestTask(key);
    if (concurrent.row) return { task: rowToSkillTask<TResult>(concurrent.row, input.skillId), reused: true };
    const task = failedTask(input.skillId, input.scope, "server", "Could not reserve the task.") as SkillTask<TResult>;
    return { task, reused: false };
  }

  let outcome: { result: TResult; costUsd: number };
  try {
    outcome = await input.call();
  } catch (err) {
    await releaseReservation(input.ownerHash, reservation.row.id);
    await cancelSpend(spend);
    const { kind, message } = classifyCallError(err);
    const task = failedTask(input.skillId, input.scope, kind, message) as SkillTask<TResult>;
    return { task, reused: false };
  }

  const now = new Date().toISOString();
  const resultMeta = { costUsd: outcome.costUsd, resultVersion: RESULT_VERSION, result: outcome.result };
  await getSupabaseAdmin()
    .from("provider_tasks")
    .update({ status: "complete", result_meta: resultMeta, updated_at: now })
    .eq("owner_hash", input.ownerHash)
    .eq("id", reservation.row.id);
  await settleLedger(input.ownerHash, input.ledgerAuditId, provider, operation, outcome.costUsd);

  const completedRow: ProviderTaskRow = { ...reservation.row, status: "complete", result_meta: resultMeta, updated_at: now };
  return { task: rowToSkillTask<TResult>(completedRow, input.skillId), reused: false };
}

// --- Shared HTTP gate for the four `app/api/skills/<paid-id>/route.ts`
// handlers. Distinct from routeHelpers.skillGate: paid routes need a
// second (daily) rate bucket and a provider-configured check, and their
// scope shapes ("keyword" vs "site") vary per skill, so body parsing stays
// in each route.

const PAID_IP_LIMIT_PER_MIN = 3;
const PAID_IP_LIMIT_PER_DAY = 10;

export function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Rate limit (per-IP, minute + day) -> owner resolve -> provider configured. */
export async function paidSkillGate(request: Request, skillId: SkillId): Promise<{ ownerHash: string } | Response> {
  const ip = clientIp(request);
  const minute = checkRateLimit(`skills:${skillId}:ip:min:${ip}`, PAID_IP_LIMIT_PER_MIN, 60);
  const day = minute.allowed
    ? checkRateLimit(`skills:${skillId}:ip:day:${ip}`, PAID_IP_LIMIT_PER_DAY, 86_400)
    : minute;
  if (!minute.allowed || !day.allowed) {
    return json(429, { error: "rate_limit", retryAfter: Math.max(minute.retryAfterSec, day.retryAfterSec) });
  }
  if (!cloudHistoryConfigured()) return json(503, { error: "cloud_unavailable" });
  const ownerHash = await resolveOwnerHashFromRequest(request);
  if (ownerHash === null) return json(401, { error: "invalid_owner" });
  if (!dataForSeoConfigured()) return json(503, { error: "provider_unavailable" });
  return { ownerHash };
}

/** Owner-only gate for the §8 GET ?id= poll (no rate limit or provider check — a read of an
 * already-paid-for task shouldn't 503 just because the provider is briefly unconfigured). */
export async function paidSkillReadGate(request: Request): Promise<{ ownerHash: string } | Response> {
  if (!cloudHistoryConfigured()) return json(503, { error: "cloud_unavailable" });
  const ownerHash = await resolveOwnerHashFromRequest(request);
  if (ownerHash === null) return json(401, { error: "invalid_owner" });
  return { ownerHash };
}

/** Confirms the owner actually holds this auditId (required: provider_tasks.audit_id FKs to it). */
export async function resolveOwnedAudit(ownerHash: string, auditId: string): Promise<{ url: string } | Response> {
  const { data, error } = await getSupabaseAdmin()
    .from("audit_runs")
    .select("id,url")
    .eq("owner_hash", ownerHash)
    .eq("id", auditId)
    .maybeSingle();
  if (error) return json(503, { error: "cloud_read_failed" });
  if (!data) return json(404, { error: "audit_not_found" });
  return { url: String((data as { url: unknown }).url) };
}

/** Normalized host (no "www.", lowercase via URL parsing), or "" if unparseable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}
