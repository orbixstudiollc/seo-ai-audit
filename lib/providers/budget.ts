import { getSupabaseAdmin } from "@/lib/cloud/server";

/**
 * F2-BUDGET (D-016): the spend gate every PAID provider call must pass before
 * reserving a task. Sums the last 24h of ledger spend (actual when settled,
 * estimated for in-flight reservations) per owner AND globally inside one
 * atomic security-definer RPC, so concurrent requests cannot race past a cap.
 *
 * Caps come from env so the operator tunes them in Vercel without a deploy:
 *   PROVIDER_OWNER_DAILY_USD  (default 1.00)  — per owner-hash, rolling 24h
 *   PROVIDER_GLOBAL_DAILY_USD (default 10.00) — whole deployment, rolling 24h
 * Setting a cap to 0 is a kill switch for paid providers.
 */

const DEFAULT_OWNER_DAILY_USD = 1;
const DEFAULT_GLOBAL_DAILY_USD = 10;

function capFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export interface BudgetCaps {
  ownerDailyUsd: number;
  globalDailyUsd: number;
}

export function budgetCaps(): BudgetCaps {
  return {
    ownerDailyUsd: capFromEnv("PROVIDER_OWNER_DAILY_USD", DEFAULT_OWNER_DAILY_USD),
    globalDailyUsd: capFromEnv("PROVIDER_GLOBAL_DAILY_USD", DEFAULT_GLOBAL_DAILY_USD),
  };
}

export interface SpendRequest {
  ownerHash: string;
  auditId: string;
  provider: string;
  /** Unique per logical call under the ledger's (owner,audit,provider,operation) key. */
  operation: string;
  estCostUsd: number;
}

export type ReserveResult =
  | { allowed: true }
  | { allowed: false; reason: "owner" | "global" }
  | { allowed: false; reason: "error" };

/**
 * Atomically check both caps and record the reservation (estimated cost, no
 * actual yet). Deny closed: an RPC failure denies the spend rather than
 * letting a paid call through unmetered.
 */
export async function reserveSpend(spend: SpendRequest): Promise<ReserveResult> {
  const caps = budgetCaps();
  const { data, error } = await getSupabaseAdmin().rpc("reserve_spend", {
    p_owner_hash: spend.ownerHash,
    p_audit_id: spend.auditId,
    p_provider: spend.provider,
    p_operation: spend.operation,
    p_est_cost: spend.estCostUsd,
    p_owner_cap: caps.ownerDailyUsd,
    p_global_cap: caps.globalDailyUsd,
  });
  if (error || !data || typeof data !== "object") return { allowed: false, reason: "error" };
  const result = data as { allowed?: boolean; reason?: string };
  if (result.allowed === true) return { allowed: true };
  return { allowed: false, reason: result.reason === "global" ? "global" : "owner" };
}

/**
 * Remove an unsettled reservation after the provider call failed to start.
 * Settled rows (actual cost recorded) are real spend and stay. Best-effort:
 * a failed cancel leaves the estimate counting against the cap for 24h,
 * which errs on the safe side.
 */
export async function cancelSpend(spend: Omit<SpendRequest, "estCostUsd">): Promise<void> {
  await getSupabaseAdmin().rpc("cancel_spend", {
    p_owner_hash: spend.ownerHash,
    p_audit_id: spend.auditId,
    p_provider: spend.provider,
    p_operation: spend.operation,
  });
}
