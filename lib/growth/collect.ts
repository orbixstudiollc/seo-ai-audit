import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeParsedDocument,
  DET_SIGNALS,
  DET_SIGNAL_IDS,
  LENSES,
  RUB_SIGNAL_IDS,
  SIGNALS_VERSION,
  type DetSignalId,
  type Lens,
  type RubSignalId,
  type RubSignalResult,
} from "@aeo/scoring";
import { estimateRescore } from "@/lib/audit/derive";
import { ImportError } from "@/lib/import/errors";
import { fetchArticle } from "@/lib/import/fetchArticle";

/**
 * G2 snapshot collector (DATA-CONTRACT §13, D-019). Pure DET sampling — zero
 * LLM/provider spend on this path. Every fetch goes through fetchArticle so
 * the SSRF guard + redirect pinning + byte cap apply unchanged. Page content
 * is never logged; snapshots persist derived scores and a content hash only.
 */

export interface DueSite {
  ownerHash: string;
  url: string;
  lastRunAt: string | null;
}

type DueSiteRow = { owner_hash: string; url: string; last_run_at: string | null };

function utcDayStart(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/**
 * Sites not yet snapshotted today (UTC), least-recently-run first with
 * never-run sites LAST: existing sites keep their daily cadence even when a
 * burst of fresh registrations (or a mintable-owner abuser) floods the queue —
 * new rows only consume whatever budget is left over. (Security review G2:
 * nulls-first let an attacker starve every legitimate site's daily snapshot.)
 */
export async function dueSites(db: SupabaseClient, now: Date, max: number): Promise<DueSite[]> {
  const { data, error } = await db
    .from("tracked_sites")
    .select("owner_hash,url,last_run_at")
    .or(`last_run_at.is.null,last_run_at.lt.${utcDayStart(now)}`)
    .order("last_run_at", { ascending: true, nullsFirst: false })
    .limit(max);
  if (error) throw new Error("tracked_sites_read_failed");
  return ((data ?? []) as DueSiteRow[]).map((row) => ({
    ownerHash: row.owner_hash,
    url: row.url,
    lastRunAt: row.last_run_at,
  }));
}

/**
 * CAS claim: advance last_run_at only if it still equals what dueSites saw.
 * Zero rows updated = another invocation claimed it first — skip.
 */
export async function claimSite(
  db: SupabaseClient,
  site: DueSite,
  observedLastRunAt: string | null,
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  let query = db
    .from("tracked_sites")
    .update({ last_run_at: nowIso, updated_at: nowIso })
    .eq("owner_hash", site.ownerHash)
    .eq("url", site.url);
  query = observedLastRunAt === null ? query.is("last_run_at", null) : query.eq("last_run_at", observedLastRunAt);
  const { data, error } = await query.select("url");
  return !error && Array.isArray(data) && data.length > 0;
}

function rubSignalsFrom(payload: unknown, url: string): Record<RubSignalId, RubSignalResult> | null {
  if (!payload || typeof payload !== "object") return null;
  const item = payload as {
    kind?: unknown;
    report?: { scores?: { signals?: unknown } };
    state?: { pages?: Record<string, { scores?: { signals?: unknown } | null }> };
  };
  const signals = item.kind === "single"
    ? item.report?.scores?.signals
    : item.kind === "site"
      ? item.state?.pages?.[url]?.scores?.signals
      : null;
  if (!signals || typeof signals !== "object") return null;
  const bag = signals as Record<string, { score?: unknown } | undefined>;
  const entries: Array<[RubSignalId, RubSignalResult]> = [];
  for (const id of RUB_SIGNAL_IDS) {
    const candidate = bag[id];
    if (!candidate || typeof candidate.score !== "number") return null;
    entries.push([id, candidate as RubSignalResult]);
  }
  return Object.fromEntries(entries) as Record<RubSignalId, RubSignalResult>;
}

/** Last full audit's RUB signals for this exact url, or null before the first audit. */
async function latestRubSignals(
  db: SupabaseClient,
  ownerHash: string,
  url: string,
): Promise<Record<RubSignalId, RubSignalResult> | null> {
  const { data: run, error: runError } = await db
    .from("audit_runs")
    .select("id")
    .eq("owner_hash", ownerHash)
    .eq("url", url)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runError || !run) return null;
  const { data: report, error: reportError } = await db
    .from("audit_reports")
    .select("payload")
    .eq("owner_hash", ownerHash)
    .eq("audit_id", (run as { id: string }).id)
    .maybeSingle();
  if (reportError) return null;
  return rubSignalsFrom((report as { payload?: unknown } | null)?.payload, url);
}

/** Most recent prior snapshot's content hash (fetch-failed days carry none). */
async function previousContentHash(
  db: SupabaseClient,
  ownerHash: string,
  url: string,
  capturedOn: string,
): Promise<string | null> {
  const { data } = await db
    .from("site_snapshots")
    .select("content_hash")
    .eq("owner_hash", ownerHash)
    .eq("url", url)
    .lt("captured_on", capturedOn)
    .not("content_hash", "is", null)
    .order("captured_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { content_hash: string | null } | null)?.content_hash ?? null;
}

interface SnapshotRow {
  owner_hash: string;
  url: string;
  captured_on: string;
  det_scores: Record<DetSignalId, number> | null;
  lens_estimate: Record<Lens, number> | null;
  signals_version: string;
  content_hash: string | null;
  fetch_meta: Record<string, unknown>;
  updated_at: string;
}

async function upsertSnapshot(db: SupabaseClient, row: SnapshotRow): Promise<void> {
  const { error } = await db
    .from("site_snapshots")
    .upsert(row, { onConflict: "owner_hash,url,captured_on" });
  if (error) throw new Error("snapshot_write_failed");
}

/**
 * Capture one (owner, url, day) snapshot. Idempotent: re-runs upsert over the
 * same primary key. Returns ok:false when the fetch failed (an error row is
 * still written so the series shows the gap).
 */
export async function snapshotSite(
  db: SupabaseClient,
  ownerHash: string,
  url: string,
  now: Date,
): Promise<{ ok: boolean }> {
  const capturedOn = now.toISOString().slice(0, 10);
  const nowIso = now.toISOString();
  const base = { owner_hash: ownerHash, url, captured_on: capturedOn, updated_at: nowIso };

  let html: string;
  try {
    ({ html } = await fetchArticle(url));
  } catch (error) {
    // Kind-only string — never the message (it can echo response details).
    const kind = error instanceof ImportError ? error.kind : "fetch_failed";
    await upsertSnapshot(db, {
      ...base,
      det_scores: null,
      lens_estimate: null,
      signals_version: SIGNALS_VERSION,
      content_hash: null,
      fetch_meta: { error: kind },
    });
    return { ok: false };
  }

  const doc = computeParsedDocument(html, true);
  const detScores = Object.fromEntries(
    DET_SIGNAL_IDS.map((id) => [id, DET_SIGNALS[id](doc).score]),
  ) as Record<DetSignalId, number>;
  const contentHash = createHash("sha256").update(doc.plainText).digest("hex");
  const previousHash = await previousContentHash(db, ownerHash, url, capturedOn);
  const changed = previousHash !== null && previousHash !== contentHash;

  const rubSignals = await latestRubSignals(db, ownerHash, url);
  let lensEstimate: Record<Lens, number> | null = null;
  if (rubSignals) {
    const lenses = estimateRescore(html, rubSignals, true);
    lensEstimate = Object.fromEntries(
      LENSES.map((lens) => [lens, lenses[lens].score]),
    ) as Record<Lens, number>;
  }

  await upsertSnapshot(db, {
    ...base,
    det_scores: detScores,
    lens_estimate: lensEstimate,
    signals_version: SIGNALS_VERSION,
    content_hash: contentHash,
    fetch_meta: changed ? { changed: true } : {},
  });
  return { ok: true };
}

/** Drop snapshots older than the retention window. Returns rows deleted. */
export async function pruneOldSnapshots(db: SupabaseClient, now: Date, cutoffDays = 400): Promise<number> {
  const cutoff = new Date(now.getTime() - cutoffDays * 86_400_000).toISOString().slice(0, 10);
  const { count, error } = await db
    .from("site_snapshots")
    .delete({ count: "exact" })
    .lt("captured_on", cutoff);
  return error ? 0 : count ?? 0;
}
