import { cloudFetch } from "@/lib/cloud/request";
import type { GrowthSeries, TrackedSite } from "./types";

/**
 * Thin client fetchers over the §13 tracked-sites/growth routes. Every call
 * goes through cloudFetch (owner header + optional auth). No retries — the
 * Growth tab treats any failure as "tracking unavailable" and stays on the
 * G1 surface.
 */

export type GrowthClientReason =
  | "audit_required" // 404 — no audit on record for that url
  | "limit_reached" // 409 — >10 tracked sites per owner
  | "rate_limit" // 429
  | "invalid_url" // 400
  | "unavailable"; // network error / unexpected status or body

export type GrowthResult<T> = { ok: true; data: T } | { ok: false; reason: GrowthClientReason };

function reasonFor(status: number): GrowthClientReason {
  if (status === 404) return "audit_required";
  if (status === 409) return "limit_reached";
  if (status === 429) return "rate_limit";
  if (status === 400) return "invalid_url";
  return "unavailable";
}

export async function listTrackedSites(): Promise<GrowthResult<TrackedSite[]>> {
  try {
    const response = await cloudFetch("/api/tracked-sites", { method: "GET" });
    if (!response.ok) return { ok: false, reason: reasonFor(response.status) };
    const body = (await response.json()) as { sites?: TrackedSite[] };
    if (!Array.isArray(body.sites)) return { ok: false, reason: "unavailable" };
    return { ok: true, data: body.sites };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function trackSite(url: string): Promise<GrowthResult<TrackedSite>> {
  try {
    const response = await cloudFetch("/api/tracked-sites", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
    if (!response.ok) return { ok: false, reason: reasonFor(response.status) };
    const body = (await response.json()) as { site?: TrackedSite };
    if (!body.site) return { ok: false, reason: "unavailable" };
    return { ok: true, data: body.site };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function untrackSite(url: string): Promise<GrowthResult<true>> {
  try {
    const response = await cloudFetch("/api/tracked-sites", {
      method: "DELETE",
      body: JSON.stringify({ url }),
    });
    if (!response.ok) return { ok: false, reason: reasonFor(response.status) };
    return { ok: true, data: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function fetchGrowthSeries(url: string, days = 30): Promise<GrowthResult<GrowthSeries>> {
  try {
    const response = await cloudFetch(
      `/api/growth?url=${encodeURIComponent(url)}&days=${days}`,
      { method: "GET" },
    );
    if (!response.ok) return { ok: false, reason: reasonFor(response.status) };
    const body = (await response.json()) as Partial<GrowthSeries>;
    if (!Array.isArray(body.series)) return { ok: false, reason: "unavailable" };
    return {
      ok: true,
      data: { url: body.url ?? url, signalsVersion: body.signalsVersion ?? "", series: body.series },
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
