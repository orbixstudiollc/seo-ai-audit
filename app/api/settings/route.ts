import { isAppSettings } from "@/lib/settings";
import { cloudHistoryConfigured, getSupabaseAdmin, ownerHashFromRequest } from "@/lib/cloud/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function requestOwner(request: Request): string | Response {
  if (!cloudHistoryConfigured()) return json(503, { error: "cloud_unavailable" });
  const owner = ownerHashFromRequest(request);
  return owner ?? json(401, { error: "invalid_owner" });
}

export async function GET(request: Request): Promise<Response> {
  const owner = requestOwner(request);
  if (owner instanceof Response) return owner;
  const { data, error } = await getSupabaseAdmin().from("device_settings").select("settings").eq("owner_hash", owner).maybeSingle();
  if (error) return json(503, { error: "cloud_read_failed" });
  if (!data || !isAppSettings(data.settings)) return json(404, { error: "settings_not_found" });
  return json(200, { settings: data.settings });
}

export async function PUT(request: Request): Promise<Response> {
  const owner = requestOwner(request);
  if (owner instanceof Response) return owner;
  let body: unknown;
  try { body = await request.json(); } catch { return json(400, { error: "invalid_body" }); }
  const settings = body && typeof body === "object" && "settings" in body ? (body as { settings?: unknown }).settings : null;
  if (!isAppSettings(settings)) return json(400, { error: "invalid_settings" });
  const { error } = await getSupabaseAdmin().from("device_settings").upsert({
    owner_hash: owner,
    version: settings.version,
    settings,
    updated_at: new Date().toISOString(),
  }, { onConflict: "owner_hash" });
  return error ? json(503, { error: "cloud_write_failed" }) : json(200, { saved: true });
}

