import { z } from "zod";
import { cloudHistoryConfigured, getSupabaseAdmin, ownerHashFromRequest } from "@/lib/cloud/server";
import {
  dataForSeoConfigured,
  pollOnPageTask,
  startOnPageTask,
  type TechnicalAuditTask,
  type TechnicalSeoResult,
} from "@/lib/dataforseo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PROVIDER = "dataforseo-onpage";

const startSchema = z.object({
  auditId: z.string().min(1).max(4096),
  url: z.string().url().max(2048),
  limit: z.number().int().min(1).max(500).default(500),
});

type ProviderTaskRow = {
  audit_id: string;
  provider_task_id: string | null;
  status: string;
  request: Record<string, unknown>;
  result_meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function requestOwner(request: Request): string | Response {
  if (!cloudHistoryConfigured()) return json(503, { error: "cloud_unavailable" });
  const owner = ownerHashFromRequest(request);
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

async function latestTask(owner: string, auditId: string): Promise<{ row: ProviderTaskRow | null; error: unknown }> {
  const { data, error } = await getSupabaseAdmin()
    .from("provider_tasks")
    .select("audit_id,provider_task_id,status,request,result_meta,created_at,updated_at")
    .eq("owner_hash", owner)
    .eq("audit_id", auditId)
    .eq("provider", PROVIDER)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { row: data as ProviderTaskRow | null, error };
}

async function ensureUsageLedger(owner: string, row: ProviderTaskRow): Promise<boolean> {
  const costUsd = typeof row.result_meta?.costUsd === "number" ? row.result_meta.costUsd : null;
  if (costUsd === null || !row.provider_task_id) return false;
  const maxCrawlPages = typeof row.request?.maxCrawlPages === "number" ? row.request.maxCrawlPages : null;
  const { error } = await getSupabaseAdmin().from("usage_ledger").upsert({
    owner_hash: owner,
    audit_id: row.audit_id,
    provider: PROVIDER,
    operation: "on_page_task",
    actual_cost_usd: costUsd,
    metadata: { providerTaskId: row.provider_task_id, maxCrawlPages },
  }, { onConflict: "owner_hash,audit_id,provider,operation" });
  return !error;
}

export async function POST(request: Request): Promise<Response> {
  const owner = requestOwner(request);
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

  const existing = await latestTask(owner, auditId);
  if (existing.error) return json(503, { error: "cloud_read_failed" });
  if (existing.row) {
    const ledgerRecorded = await ensureUsageLedger(owner, existing.row);
    return json(200, { task: rowToTask(existing.row), reused: true, ledgerRecorded });
  }

  const now = new Date().toISOString();
  const safeRequest = { target: requestedHost, maxCrawlPages: limit };
  const { data: reserved, error: reserveError } = await db
    .from("provider_tasks")
    .insert({
      owner_hash: owner,
      audit_id: auditId,
      provider: PROVIDER,
      provider_task_id: null,
      status: "creating",
      request: safeRequest,
      result_meta: {},
      updated_at: now,
    })
    .select("audit_id,provider_task_id,status,request,result_meta,created_at,updated_at")
    .single();
  if (reserveError || !reserved) {
    const concurrent = await latestTask(owner, auditId);
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
    await db.from("provider_tasks")
      .delete()
      .eq("owner_hash", owner)
      .eq("audit_id", auditId)
      .eq("provider", PROVIDER)
      .is("provider_task_id", null);
    return json(502, { error: "provider_start_failed" });
  }

  const updatedAt = new Date().toISOString();
  const { data: inserted, error: insertError } = await db
    .from("provider_tasks")
    .update({
      provider_task_id: started.taskId,
      status: "queued",
      result_meta: { costUsd: started.costUsd },
      updated_at: updatedAt,
    })
    .eq("owner_hash", owner)
    .eq("audit_id", auditId)
    .eq("provider", PROVIDER)
    .select("audit_id,provider_task_id,status,request,result_meta,created_at,updated_at")
    .single();
  if (insertError || !inserted) return json(503, { error: "cloud_write_failed" });

  const insertedRow = inserted as ProviderTaskRow;
  const ledgerRecorded = await ensureUsageLedger(owner, insertedRow);
  return json(201, { task: rowToTask(insertedRow), reused: false, ledgerRecorded });
}

export async function GET(request: Request): Promise<Response> {
  const owner = requestOwner(request);
  if (owner instanceof Response) return owner;
  const auditId = new URL(request.url).searchParams.get("auditId");
  if (!auditId || auditId.length > 4096) return json(400, { error: "invalid_audit_id" });

  const current = await latestTask(owner, auditId);
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
