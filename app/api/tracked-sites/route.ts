import { z } from "zod";
import { cloudHistoryConfigured, getSupabaseAdmin, resolveOwnerHashFromRequest } from "@/lib/cloud/server";
import { checkRateLimit } from "@/lib/audit/ratelimit";
import { clientIp } from "@/lib/audit/httpHelpers";
import { assertSafeUrl } from "@/lib/import/ssrfGuard";
import type { TrackedSite } from "@/lib/growth/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DATA-CONTRACT §13: at most 10 tracked sites per owner. */
const TRACKED_SITE_LIMIT = 10;
const POST_IP_LIMIT_PER_MIN = 10;

const urlSchema = z.object({ url: z.string().url().max(2048) });

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function requestOwner(request: Request): Promise<string | Response> {
  if (!cloudHistoryConfigured()) return json(503, { error: "cloud_unavailable" });
  const ownerHash = await resolveOwnerHashFromRequest(request);
  return ownerHash ?? json(401, { error: "invalid_owner" });
}

type TrackedSiteRow = { url: string; created_at: string; last_run_at: string | null };

function rowToSite(row: TrackedSiteRow): TrackedSite {
  return { url: row.url, createdAt: row.created_at, lastRunAt: row.last_run_at };
}

async function parseUrlBody(request: Request): Promise<string | Response> {
  const parsed = urlSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_url" });
  const target = new URL(parsed.data.url);
  if (target.protocol !== "http:" && target.protocol !== "https:") return json(400, { error: "invalid_url" });
  return parsed.data.url;
}

export async function GET(request: Request): Promise<Response> {
  const owner = await requestOwner(request);
  if (owner instanceof Response) return owner;
  const { data, error } = await getSupabaseAdmin()
    .from("tracked_sites")
    .select("url,created_at,last_run_at")
    .eq("owner_hash", owner)
    .order("created_at", { ascending: false });
  if (error) return json(503, { error: "cloud_read_failed" });
  return json(200, { sites: ((data ?? []) as TrackedSiteRow[]).map(rowToSite) });
}

export async function POST(request: Request): Promise<Response> {
  // Gate order is contract (§13): rate limit before any parsing or DB work.
  const ip = clientIp(request);
  const minute = checkRateLimit(`tracked-sites:ip:min:${ip}`, POST_IP_LIMIT_PER_MIN, 60);
  if (!minute.allowed) return json(429, { error: "rate_limit", retryAfter: minute.retryAfterSec });

  const owner = await requestOwner(request);
  if (owner instanceof Response) return owner;

  const url = await parseUrlBody(request);
  if (url instanceof Response) return url;

  try {
    // Reuses the import-path SSRF policy; we only validate here (no fetch),
    // so release the pinned dispatcher immediately.
    const safe = await assertSafeUrl(url);
    await safe.dispatcher.close().catch(() => undefined);
  } catch {
    return json(400, { error: "invalid_url" });
  }

  const db = getSupabaseAdmin();
  // Tracking is free-tier only for urls the owner has actually audited.
  const { data: audit, error: auditError } = await db
    .from("audit_runs")
    .select("id")
    .eq("owner_hash", owner)
    .eq("url", url)
    .limit(1)
    .maybeSingle();
  if (auditError) return json(503, { error: "cloud_read_failed" });
  if (!audit) return json(404, { error: "audit_required" });

  const { count, error: countError } = await db
    .from("tracked_sites")
    .select("url", { count: "exact", head: true })
    .eq("owner_hash", owner);
  if (countError) return json(503, { error: "cloud_read_failed" });
  if ((count ?? 0) >= TRACKED_SITE_LIMIT) return json(409, { error: "limit_reached" });

  // PK collision = the site is already tracked — idempotent 201.
  const { data: siteRow, error: upsertError } = await db
    .from("tracked_sites")
    .upsert({ owner_hash: owner, url }, { onConflict: "owner_hash,url" })
    .select("url,created_at,last_run_at")
    .single();
  if (upsertError || !siteRow) return json(503, { error: "cloud_write_failed" });
  return json(201, { site: rowToSite(siteRow as TrackedSiteRow) });
}

export async function DELETE(request: Request): Promise<Response> {
  const owner = await requestOwner(request);
  if (owner instanceof Response) return owner;

  const url = await parseUrlBody(request);
  if (url instanceof Response) return url;

  const { error } = await getSupabaseAdmin()
    .from("tracked_sites")
    .delete()
    .eq("owner_hash", owner)
    .eq("url", url);
  if (error) return json(503, { error: "cloud_delete_failed" });
  return json(200, { ok: true });
}
