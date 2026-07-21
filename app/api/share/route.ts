import { randomBytes } from "node:crypto";
import { checkRateLimit } from "@/lib/audit/ratelimit";
import { clientIp } from "@/lib/audit/httpHelpers";
import { cloudHistoryConfigured, getSupabaseAdmin, resolveOwnerHashFromRequest } from "@/lib/cloud/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POST_IP_LIMIT_PER_MIN = 10;

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function requestOwner(request: Request): Promise<string | Response> {
  if (!cloudHistoryConfigured()) return json(503, { error: "cloud_unavailable" });
  const ownerHash = await resolveOwnerHashFromRequest(request);
  return ownerHash ?? json(401, { error: "invalid_owner" });
}

async function parseAuditId(request: Request): Promise<string | Response> {
  const body = await request.json().catch(() => null);
  const auditId = body && typeof body === "object" && "auditId" in body ? (body as { auditId?: unknown }).auditId : null;
  if (typeof auditId !== "string" || auditId.length === 0 || auditId.length > 4096) return json(400, { error: "invalid_audit_id" });
  return auditId;
}

/** Mint (or return the existing) public share token for one of the owner's stored reports. */
export async function POST(request: Request): Promise<Response> {
  const ip = clientIp(request);
  const minute = checkRateLimit(`share:ip:min:${ip}`, POST_IP_LIMIT_PER_MIN, 60);
  if (!minute.allowed) return json(429, { error: "rate_limit", retryAfter: minute.retryAfterSec });

  const owner = await requestOwner(request);
  if (owner instanceof Response) return owner;
  const auditId = await parseAuditId(request);
  if (auditId instanceof Response) return auditId;

  const admin = getSupabaseAdmin();
  // Only reports that actually exist in the owner's workspace are shareable.
  const { data: report, error: reportError } = await admin
    .from("audit_reports")
    .select("audit_id")
    .eq("owner_hash", owner)
    .eq("audit_id", auditId)
    .maybeSingle();
  if (reportError) return json(503, { error: "cloud_read_failed" });
  if (!report) return json(404, { error: "report_not_found" });

  // ignoreDuplicates + re-select keeps one stable token per report, race-safe.
  const { error: upsertError } = await admin
    .from("share_links")
    .upsert(
      { token: randomBytes(16).toString("hex"), owner_hash: owner, audit_id: auditId },
      { onConflict: "owner_hash,audit_id", ignoreDuplicates: true },
    );
  if (upsertError) return json(503, { error: "cloud_write_failed" });
  const { data: link, error: linkError } = await admin
    .from("share_links")
    .select("token")
    .eq("owner_hash", owner)
    .eq("audit_id", auditId)
    .maybeSingle();
  if (linkError || !link) return json(503, { error: "cloud_read_failed" });
  return json(200, { token: link.token });
}

/** Revoke the share link for one of the owner's reports. Idempotent. */
export async function DELETE(request: Request): Promise<Response> {
  const owner = await requestOwner(request);
  if (owner instanceof Response) return owner;
  const auditId = await parseAuditId(request);
  if (auditId instanceof Response) return auditId;

  const { error } = await getSupabaseAdmin()
    .from("share_links")
    .delete()
    .eq("owner_hash", owner)
    .eq("audit_id", auditId);
  if (error) return json(503, { error: "cloud_write_failed" });
  return json(200, { ok: true });
}
