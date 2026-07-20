import { z } from "zod";
import { DET_SIGNAL_IDS, SIGNALS_VERSION, type DetSignalId, type Lens } from "@aeo/scoring";
import { cloudHistoryConfigured, getSupabaseAdmin, resolveOwnerHashFromRequest } from "@/lib/cloud/server";
import type { GrowthSeries, GrowthSnapshot } from "@/lib/growth/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  url: z.string().url().max(2048),
  days: z.coerce.number().int().min(1).max(90).default(30),
});

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function requestOwner(request: Request): Promise<string | Response> {
  if (!cloudHistoryConfigured()) return json(503, { error: "cloud_unavailable" });
  const ownerHash = await resolveOwnerHashFromRequest(request);
  return ownerHash ?? json(401, { error: "invalid_owner" });
}

type SnapshotRow = {
  captured_on: string;
  det_scores: Record<string, unknown> | null;
  lens_estimate: Record<Lens, number> | null;
  signals_version: string;
  fetch_meta: Record<string, unknown> | null;
};

function rowToSnapshot(row: SnapshotRow): GrowthSnapshot {
  // Wire shape is score-only per DetSignalId — rebuild from the id list so a
  // row that ever stored richer detail still emits the compact contract map.
  const det = row.det_scores
    ? (Object.fromEntries(
        DET_SIGNAL_IDS.map((id) => [id, Number(row.det_scores?.[id] ?? 0)]),
      ) as Record<DetSignalId, number>)
    : null;
  return {
    d: row.captured_on,
    det,
    lens: row.lens_estimate ?? null,
    ...(row.fetch_meta?.changed === true ? { changed: true as const } : {}),
    ...(typeof row.fetch_meta?.error === "string" ? { err: true as const } : {}),
  };
}

export async function GET(request: Request): Promise<Response> {
  const owner = await requestOwner(request);
  if (owner instanceof Response) return owner;

  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    url: params.get("url") ?? undefined,
    days: params.get("days") ?? undefined,
  });
  if (!parsed.success) return json(400, { error: "invalid_request" });
  const target = new URL(parsed.data.url);
  if (target.protocol !== "http:" && target.protocol !== "https:") return json(400, { error: "invalid_request" });

  const { data, error } = await getSupabaseAdmin()
    .from("site_snapshots")
    .select("captured_on,det_scores,lens_estimate,signals_version,fetch_meta")
    .eq("owner_hash", owner)
    .eq("url", parsed.data.url)
    .order("captured_on", { ascending: false })
    .limit(parsed.data.days);
  if (error) return json(503, { error: "cloud_read_failed" });

  const rows = (data ?? []) as SnapshotRow[];
  const body: GrowthSeries = {
    url: parsed.data.url,
    // Newest row's engine stamp; current engine when the series is empty.
    signalsVersion: rows[0]?.signals_version ?? SIGNALS_VERSION,
    series: rows.slice().reverse().map(rowToSnapshot),
  };
  return json(200, body);
}
