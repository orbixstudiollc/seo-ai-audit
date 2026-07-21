import { getSupabaseAdmin } from "@/lib/cloud/server";

/**
 * F2-BUDGET: the reserve→start→attach/release provider-task flow, extracted
 * from app/api/technical-audit/route.ts so every provider route (on-page
 * crawl today; SERP/keywords/backlinks/labs in W1-DFS) shares one
 * implementation of the idempotency dance instead of re-inventing it.
 *
 * `fingerprint` distinguishes multiple calls per (owner, audit, provider):
 * '' for one-task-per-audit providers (the on-page crawl's existing rows keep
 * working unchanged), sha256-of-request for per-call providers. Uniqueness is
 * enforced by provider_tasks_owner_audit_provider_fp_unique.
 */

export interface ProviderTaskRow {
  id: string;
  audit_id: string;
  provider_task_id: string | null;
  status: string;
  request: Record<string, unknown>;
  result_meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const ROW_COLUMNS = "id,audit_id,provider_task_id,status,request,result_meta,created_at,updated_at";

export interface TaskKey {
  ownerHash: string;
  auditId: string;
  provider: string;
  fingerprint?: string;
}

/** Looks up one row by primary key (owner-scoped) — the §8 GET ?id= poll path. */
export async function taskById(ownerHash: string, id: string): Promise<{ row: ProviderTaskRow | null; error: unknown }> {
  const { data, error } = await getSupabaseAdmin()
    .from("provider_tasks")
    .select(ROW_COLUMNS)
    .eq("owner_hash", ownerHash)
    .eq("id", id)
    .maybeSingle();
  return { row: data as ProviderTaskRow | null, error };
}

export async function latestTask(key: TaskKey): Promise<{ row: ProviderTaskRow | null; error: unknown }> {
  const { data, error } = await getSupabaseAdmin()
    .from("provider_tasks")
    .select(ROW_COLUMNS)
    .eq("owner_hash", key.ownerHash)
    .eq("audit_id", key.auditId)
    .eq("provider", key.provider)
    .eq("request_fingerprint", key.fingerprint ?? "")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { row: data as ProviderTaskRow | null, error };
}

/**
 * Insert the 'creating' reservation row. The unique index makes concurrent
 * reservations collide: exactly one caller wins; losers re-read the winner's
 * row and reuse it.
 */
export async function reserveTask(
  key: TaskKey,
  request: Record<string, unknown>,
): Promise<{ row: ProviderTaskRow | null; error: unknown }> {
  const { data, error } = await getSupabaseAdmin()
    .from("provider_tasks")
    .insert({
      owner_hash: key.ownerHash,
      audit_id: key.auditId,
      provider: key.provider,
      request_fingerprint: key.fingerprint ?? "",
      provider_task_id: null,
      status: "creating",
      request,
      result_meta: {},
      updated_at: new Date().toISOString(),
    })
    .select(ROW_COLUMNS)
    .single();
  return { row: data as ProviderTaskRow | null, error };
}

/** Promote a reservation to a live provider task. Targets the reserved row by primary key. */
export async function attachProviderTask(
  ownerHash: string,
  reservationId: string,
  providerTaskId: string,
  resultMeta: Record<string, unknown>,
): Promise<{ row: ProviderTaskRow | null; error: unknown }> {
  const { data, error } = await getSupabaseAdmin()
    .from("provider_tasks")
    .update({
      provider_task_id: providerTaskId,
      status: "queued",
      result_meta: resultMeta,
      updated_at: new Date().toISOString(),
    })
    .eq("owner_hash", ownerHash)
    .eq("id", reservationId)
    .select(ROW_COLUMNS)
    .single();
  return { row: data as ProviderTaskRow | null, error };
}

/**
 * Drop a reservation whose provider call never started. Deletes by primary
 * key — the pre-F2 version deleted every NULL-provider_task_id row for the
 * (owner, audit, provider) triple, which could destroy a CONCURRENT caller's
 * fresh reservation and let a second paid task start (the reservation-delete
 * race, flagged in the platform plan).
 */
export async function releaseReservation(ownerHash: string, reservationId: string): Promise<void> {
  await getSupabaseAdmin()
    .from("provider_tasks")
    .delete()
    .eq("owner_hash", ownerHash)
    .eq("id", reservationId);
}
