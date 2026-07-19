import {
  cloudHistoryConfigured,
  getSupabaseAdmin,
  ownerHashFromRequest,
  verifiedAccountFromRequest,
} from "@/lib/cloud/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  if (!cloudHistoryConfigured()) return json(503, { error: "cloud_unavailable" });
  const account = await verifiedAccountFromRequest(request);
  if (!account) return json(401, { error: "invalid_session" });
  const deviceOwner = ownerHashFromRequest(request);
  if (!deviceOwner) return json(400, { error: "invalid_owner" });

  const { error } = await getSupabaseAdmin().rpc("claim_anonymous_workspace", {
    p_device_hash: deviceOwner,
    p_user_hash: account.ownerHash,
  });
  if (error) return json(503, { error: "workspace_link_failed" });
  return json(200, { linked: true, email: account.email });
}
