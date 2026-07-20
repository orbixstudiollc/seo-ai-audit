import { timingSafeEqual } from "node:crypto";
import { cloudHistoryConfigured, getSupabaseAdmin } from "@/lib/cloud/server";
import { claimSite, dueSites, pruneOldSnapshots, snapshotSite } from "@/lib/growth/collect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** §13: bounded per invocation — ≤25 sites under a 240s deadline. */
const MAX_SITES_PER_RUN = 25;
const DEADLINE_MS = 240_000;

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Constant-time compare of the Authorization header against Bearer <secret>. */
function authorized(request: Request, secret: string): boolean {
  const header = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (header.length !== expected.length) return false;
  return timingSafeEqual(header, expected);
}

export async function GET(request: Request): Promise<Response> {
  // Deny-closed: no secret or no cloud = this endpoint does not exist yet.
  const secret = process.env.CRON_SECRET;
  if (!secret || !cloudHistoryConfigured()) return json(503, { error: "cron_unavailable" });
  if (!authorized(request, secret)) return json(401, { error: "unauthorized" });

  const db = getSupabaseAdmin();
  const now = new Date();
  const startedAt = Date.now();

  let sites;
  try {
    sites = await dueSites(db, now, MAX_SITES_PER_RUN);
  } catch {
    return json(503, { error: "cloud_read_failed" });
  }

  let scanned = 0;
  let captured = 0;
  let failed = 0;
  // ponytail: sequential — 25 sites × ≤10s fetch timeout fits the 240s
  // deadline with room to spare; move to a small worker pool (3-4 concurrent
  // snapshotSite calls) if MAX_SITES_PER_RUN ever grows past ~40.
  for (const site of sites) {
    if (Date.now() - startedAt > DEADLINE_MS) break;
    scanned += 1;
    // CAS claim: an overlapping invocation that already advanced last_run_at
    // wins; we skip rather than double-fetch.
    if (!(await claimSite(db, site, site.lastRunAt))) continue;
    try {
      const result = await snapshotSite(db, site.ownerHash, site.url, new Date());
      if (result.ok) captured += 1;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }

  const pruned = await pruneOldSnapshots(db, now);
  return json(200, { scanned, captured, failed, pruned });
}
