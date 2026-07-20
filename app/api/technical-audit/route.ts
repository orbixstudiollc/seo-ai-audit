import { z } from "zod";
import { cloudHistoryConfigured, getSupabaseAdmin, resolveOwnerHashFromRequest } from "@/lib/cloud/server";
import {
  dataForSeoConfigured,
  pollOnPageTask,
  startOnPageTask,
  type TechnicalAuditTask,
  type TechnicalSeoResult,
} from "@/lib/dataforseo";
import { checkRateLimit } from "@/lib/audit/ratelimit";
import { clientIp } from "@/lib/audit/httpHelpers";
import { cancelSpend, reserveSpend } from "@/lib/providers/budget";
import {
  attachProviderTask,
  latestTask,
  releaseReservation,
  reserveTask,
  type ProviderTaskRow,
} from "@/lib/providers/taskStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROVIDER = "dataforseo-onpage";
const LEDGER_OPERATION = "on_page_task";

// This endpoint spends real DataForSEO money; before F2 it had NO rate limit
// (per-owner idempotency doesn't help — device tokens are free to mint).
const START_IP_LIMIT_PER_MIN = 3;
const START_IP_LIMIT_PER_DAY = 10;

// Cost anchor: the live validation crawl billed $0.00015 for one page.
// Reserve pessimistically at ~$0.0002/page so the estimate over-counts until
// the actual cost settles.
const EST_COST_PER_PAGE_USD = 0.0002;

const startSchema = z.object({
  auditId: z.string().min(1).max(4096),
  url: z.string().url().max(2048),
  limit: z.number().int().min(1).max(500).default(500),
});

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function requestOwner(request: Request): Promise<string | Response> {
  if (!cloudHistoryConfigured()) return json(503, { error: "cloud_unavailable" });
  const owner = await resolveOwnerHashFromRequest(request);
  return owner ?? json(401, { error: "invalid_owner" });
}

function storedResult(value: unknown): TechnicalSeoResult | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<TechnicalSeoResult>;
  if (
    typeof item.target !== "string" ||
    (item.crawlProgress !== "in_progress" && item.crawlProgress !== "finished") ||
    typeof item.maxCrawlPages !== "number" ||
    typeof item.pagesCrawled !== "number" ||
    typeof item.pagesInQueue !== "number" ||
    !Array.isArray(item.pages)
  ) return null;
  return item as TechnicalSeoResult;
}

function rowToTask(row: ProviderTaskRow): TechnicalAuditTask {
  const resultMeta = row.result_meta ?? {};
  const status = row.status === "complete" || row.status === "failed" || row.status === "running"
    ? row.status
    : "queued";
  return {
    auditId: row.audit_id,
    providerTaskId: row.provider_task_id ?? "",
    status,
    costUsd: typeof resultMeta.costUsd === "number" ? resultMeta.costUsd : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    result: storedResult(resultMeta.result),
    errorMessage: typeof resultMeta.errorMessage === "string" ? resultMeta.errorMessage : null,
  };
}

function taskKey(owner: string, auditId: string) {
  return { ownerHash: owner, auditId, provider: PROVIDER };
}

async function ensureUsageLedger(owner: string, row: ProviderTaskRow): Promise<boolean> {
  const costUsd = typeof row.result_meta?.costUsd === "number" ? row.result_meta.costUsd : null;
  if (costUsd === null || !row.provider_task_id) return false;
  const maxCrawlPages = typeof row.request?.maxCrawlPages === "number" ? row.request.maxCrawlPages : null;
  const { error } = await getSupabaseAdmin().from("usage_ledger").upsert({
    owner_hash: owner,
    audit_id: row.audit_id,
    provider: PROVIDER,
    operation: LEDGER_OPERATION,
    actual_cost_usd: costUsd,
    metadata: { providerTaskId: row.provider_task_id, maxCrawlPages },
  }, { onConflict: "owner_hash,audit_id,provider,operation" });
  return !error;
}

export async function POST(request: Request): Promise<Response> {
  // Rate-limit before any parsing or DB work (WS2-D4 precedent): this is the
  // paid surface, so the bucket is deliberately tight.
  const ip = clientIp(request);
  const minute = checkRateLimit(`technical-audit:ip:min:${ip}`, START_IP_LIMIT_PER_MIN, 60);
  const day = minute.allowed
    ? checkRateLimit(`technical-audit:ip:day:${ip}`, START_IP_LIMIT_PER_DAY, 86_400)
    : minute;
  if (!minute.allowed || !day.allowed) {
    const retryAfter = Math.max(minute.retryAfterSec, day.retryAfterSec);
    return json(429, { error: "rate_limit", retryAfter });
  }

  const owner = await requestOwner(request);
  if (owner instanceof Response) return owner;
  if (!dataForSeoConfigured()) return json(503, { error: "provider_unavailable" });

  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_request" });
  const { auditId, url, limit } = parsed.data;
  const targetUrl = new URL(url);
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") return json(400, { error: "invalid_request" });

  const db = getSupabaseAdmin();
  const { data: audit, error: auditError } = await db
    .from("audit_runs")
    .select("id,url")
    .eq("owner_hash", owner)
    .eq("id", auditId)
    .eq("mode", "site")
    .maybeSingle();
  if (auditError) return json(503, { error: "cloud_read_failed" });
  if (!audit) return json(404, { error: "audit_not_found" });
  let auditHost = "";
  try { auditHost = new URL(String(audit.url)).hostname.replace(/^www\./i, ""); } catch { /* Invalid stored rows cannot authorize provider spend. */ }
  const requestedHost = targetUrl.hostname.replace(/^www\./i, "");
  if (!auditHost || auditHost !== requestedHost) return json(400, { error: "audit_target_mismatch" });

  const existing = await latestTask(taskKey(owner, auditId));
  if (existing.error) return json(503, { error: "cloud_read_failed" });
  if (existing.row) {
    const ledgerRecorded = await ensureUsageLedger(owner, existing.row);
    return json(200, { task: rowToTask(existing.row), reused: true, ledgerRecorded });
  }

  // Spend gate (D-016): deny before reserving anything. The reservation row
  // in usage_ledger counts against the caps until the actual cost settles.
  const spend = {
    ownerHash: owner,
    auditId,
    provider: PROVIDER,
    operation: LEDGER_OPERATION,
    estCostUsd: limit * EST_COST_PER_PAGE_USD,
  };
  const budget = await reserveSpend(spend);
  if (!budget.allowed) {
    return budget.reason === "error"
      ? json(503, { error: "cloud_write_failed" })
      : json(429, { error: "budget_exceeded", scope: budget.reason });
  }

  const safeRequest = { target: requestedHost, maxCrawlPages: limit };
  const reservation = await reserveTask(taskKey(owner, auditId), safeRequest);
  if (reservation.error || !reservation.row) {
    // Unique-index collision: a concurrent caller reserved first — reuse its
    // task and drop our budget reservation (theirs is the one that counts).
    await cancelSpend(spend);
    const concurrent = await latestTask(taskKey(owner, auditId));
    if (concurrent.row) {
      const ledgerRecorded = await ensureUsageLedger(owner, concurrent.row);
      return json(200, { task: rowToTask(concurrent.row), reused: true, ledgerRecorded });
    }
    return json(503, { error: "cloud_write_failed" });
  }

  let started;
  try {
    started = await startOnPageTask({
      target: safeRequest.target,
      maxCrawlPages: limit,
    });
  } catch {
    await releaseReservation(owner, reservation.row.id);
    await cancelSpend(spend);
    return json(502, { error: "provider_start_failed" });
  }

  const { row: inserted, error: insertError } = await attachProviderTask(
    owner,
    reservation.row.id,
    started.taskId,
    { costUsd: started.costUsd },
  );
  if (insertError || !inserted) return json(503, { error: "cloud_write_failed" });

  const ledgerRecorded = await ensureUsageLedger(owner, inserted);
  return json(201, { task: rowToTask(inserted), reused: false, ledgerRecorded });
}

export async function GET(request: Request): Promise<Response> {
  const owner = await requestOwner(request);
  if (owner instanceof Response) return owner;
  const auditId = new URL(request.url).searchParams.get("auditId");
  if (!auditId || auditId.length > 4096) return json(400, { error: "invalid_audit_id" });

  const current = await latestTask(taskKey(owner, auditId));
  if (current.error) return json(503, { error: "cloud_read_failed" });
  if (!current.row) return json(404, { error: "task_not_found", configured: dataForSeoConfigured() });
  const currentTask = rowToTask(current.row);
  const ledgerRecorded = await ensureUsageLedger(owner, current.row);
  if (currentTask.status === "complete" || currentTask.status === "failed") return json(200, { task: currentTask, ledgerRecorded });
  if (!dataForSeoConfigured()) return json(503, { error: "provider_unavailable", task: currentTask });
  if (!currentTask.providerTaskId) return json(503, { error: "provider_task_missing" });

  const pageLimit = typeof current.row.request.maxCrawlPages === "number"
    ? Math.max(1, Math.min(500, Math.floor(current.row.request.maxCrawlPages)))
    : 500;
  let polled;
  try {
    polled = await pollOnPageTask(currentTask.providerTaskId, pageLimit);
  } catch {
    return json(502, { error: "provider_poll_failed", task: currentTask });
  }

  const now = new Date().toISOString();
  const resultMeta = { ...current.row.result_meta, result: polled.result };
  const { error: updateError } = await getSupabaseAdmin()
    .from("provider_tasks")
    .update({ status: polled.status, result_meta: resultMeta, updated_at: now })
    .eq("owner_hash", owner)
    .eq("audit_id", auditId)
    .eq("provider_task_id", currentTask.providerTaskId);
  if (updateError) return json(503, { error: "cloud_write_failed" });

  return json(200, {
    task: rowToTask({ ...current.row, status: polled.status, result_meta: resultMeta, updated_at: now }),
    ledgerRecorded,
  });
}
