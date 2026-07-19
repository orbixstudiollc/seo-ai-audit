import { isHistoryRecord, type AuditHistoryRecord } from "@/lib/history";
import { isSavedReport, type SavedAuditReport } from "@/lib/reports";
import { cloudHistoryConfigured, getSupabaseAdmin, ownerHashFromRequest } from "@/lib/cloud/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuditRunRow = {
  id: string;
  version: number;
  url: string;
  final_url: string | null;
  title: string;
  mode: "single" | "site";
  created_at: string;
  status: "started" | "complete" | "partial" | "failed";
  scores: AuditHistoryRecord["scores"];
  page_count: number | null;
  details: AuditHistoryRecord["details"] | null;
  report_available: boolean;
};

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function readJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 8_000_000) throw new Error("payload_too_large");
  const text = await request.text();
  if (text.length > 8_000_000) throw new Error("payload_too_large");
  return JSON.parse(text) as unknown;
}

function requestOwner(request: Request): string | Response {
  if (!cloudHistoryConfigured()) return json(503, { error: "cloud_unavailable" });
  const ownerHash = ownerHashFromRequest(request);
  return ownerHash ?? json(401, { error: "invalid_owner" });
}

function recordToRow(ownerHash: string, record: AuditHistoryRecord, reportAvailable = record.reportAvailable === true) {
  return {
    owner_hash: ownerHash,
    id: record.id,
    version: record.version,
    url: record.url,
    final_url: record.finalUrl ?? null,
    title: record.title,
    mode: record.mode,
    created_at: record.createdAt,
    status: record.status,
    scores: record.scores,
    page_count: record.pageCount ?? null,
    details: record.details ?? null,
    report_available: reportAvailable,
    updated_at: new Date().toISOString(),
  };
}

function rowToRecord(row: AuditRunRow): AuditHistoryRecord | null {
  const candidate: AuditHistoryRecord = {
    id: row.id,
    version: 4,
    url: row.url,
    title: row.title,
    mode: row.mode,
    createdAt: row.created_at,
    status: row.status,
    scores: row.scores,
    ...(row.final_url ? { finalUrl: row.final_url } : {}),
    ...(row.page_count !== null ? { pageCount: row.page_count } : {}),
    ...(row.details ? { details: row.details } : {}),
    ...(row.report_available ? { reportAvailable: true } : {}),
  };
  return isHistoryRecord(candidate) ? candidate : null;
}

function reportToRow(ownerHash: string, report: SavedAuditReport) {
  return {
    owner_hash: ownerHash,
    audit_id: report.id,
    version: report.version,
    kind: report.kind,
    created_at: report.createdAt,
    payload: report,
    updated_at: new Date().toISOString(),
  };
}

export async function GET(request: Request): Promise<Response> {
  const owner = requestOwner(request);
  if (owner instanceof Response) return owner;
  const { data, error } = await getSupabaseAdmin()
    .from("audit_runs")
    .select("id,version,url,final_url,title,mode,created_at,status,scores,page_count,details,report_available")
    .eq("owner_hash", owner)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return json(503, { error: "cloud_read_failed" });
  return json(200, { records: (data as AuditRunRow[]).flatMap((row) => rowToRecord(row) ?? []) });
}

export async function POST(request: Request): Promise<Response> {
  const owner = requestOwner(request);
  if (owner instanceof Response) return owner;
  let body: unknown;
  try { body = await readJson(request); } catch (error) { return json(error instanceof Error && error.message === "payload_too_large" ? 413 : 400, { error: error instanceof Error && error.message === "payload_too_large" ? "payload_too_large" : "invalid_body" }); }
  const id = body && typeof body === "object" && "id" in body ? (body as { id?: unknown }).id : null;
  if (typeof id !== "string" || id.length === 0 || id.length > 4096) return json(400, { error: "invalid_id" });
  const { data, error } = await getSupabaseAdmin()
    .from("audit_reports")
    .select("payload")
    .eq("owner_hash", owner)
    .eq("audit_id", id)
    .maybeSingle();
  if (error) return json(503, { error: "cloud_read_failed" });
  const payload: unknown = data?.payload;
  return isSavedReport(payload) ? json(200, { report: payload }) : json(404, { error: "report_not_found" });
}

export async function PUT(request: Request): Promise<Response> {
  const owner = requestOwner(request);
  if (owner instanceof Response) return owner;
  let body: unknown;
  try { body = await readJson(request); } catch (error) { return json(error instanceof Error && error.message === "payload_too_large" ? 413 : 400, { error: error instanceof Error && error.message === "payload_too_large" ? "payload_too_large" : "invalid_body" }); }
  if (!body || typeof body !== "object") return json(400, { error: "invalid_body" });
  const input = body as { records?: unknown; report?: unknown };
  if (!Array.isArray(input.records) || input.records.length < 1 || input.records.length > 500 || !input.records.every(isHistoryRecord)) {
    return json(400, { error: "invalid_records" });
  }
  const records = input.records as AuditHistoryRecord[];
  const report = input.report === undefined ? null : isSavedReport(input.report) ? input.report : undefined;
  if (report === undefined || (report && !records.some((record) => record.id === report.id))) {
    return json(400, { error: "invalid_report" });
  }

  const rows = records.map((record) => recordToRow(owner, record, Boolean(report && report.id === record.id) || record.reportAvailable));
  const { error: runError } = await getSupabaseAdmin().from("audit_runs").upsert(rows, { onConflict: "owner_hash,id" });
  if (runError) return json(503, { error: "cloud_write_failed" });
  if (report) {
    const { error: reportError } = await getSupabaseAdmin().from("audit_reports").upsert(reportToRow(owner, report), { onConflict: "owner_hash,audit_id" });
    if (reportError) return json(503, { error: "cloud_report_write_failed" });
  }
  return json(200, { saved: records.length, reportSaved: Boolean(report) });
}

export async function DELETE(request: Request): Promise<Response> {
  const owner = requestOwner(request);
  if (owner instanceof Response) return owner;
  let body: unknown;
  try { body = await readJson(request); } catch (error) { return json(error instanceof Error && error.message === "payload_too_large" ? 413 : 400, { error: error instanceof Error && error.message === "payload_too_large" ? "payload_too_large" : "invalid_body" }); }
  const input = body && typeof body === "object" ? body as { id?: unknown; all?: unknown } : {};
  let query = getSupabaseAdmin().from("audit_runs").delete().eq("owner_hash", owner);
  if (input.all !== true) {
    if (typeof input.id !== "string" || input.id.length === 0 || input.id.length > 4096) return json(400, { error: "invalid_id" });
    query = query.eq("id", input.id);
  }
  const { error } = await query;
  if (error) return json(503, { error: "cloud_delete_failed" });
  return json(200, { deleted: true });
}
