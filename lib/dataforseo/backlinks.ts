import type { BacklinksSkillResult } from "@/lib/skills/types";
import { finiteNumber, firstResult, firstTask, nullableNumber, request, type JsonRecord } from "./client";

/**
 * Backlinks summary lookup — /v3/backlinks/summary/live. PAID.
 */
export const BACKLINKS_EST_COST_USD = 0.03;

export interface BacklinksLiveParams {
  /** Bare domain (no scheme), e.g. "example.com". */
  domain: string;
}

/** Normalizes the summary object into the §8.1 typed payload. */
export function normalizeBacklinksResult(result: JsonRecord): BacklinksSkillResult {
  return {
    totalBacklinks: finiteNumber(result.backlinks),
    referringDomains: finiteNumber(result.referring_domains),
    rank: nullableNumber(result.rank),
    brokenBacklinks: finiteNumber(result.broken_backlinks),
    referringDomainsNofollow: finiteNumber(result.referring_domains_nofollow),
  };
}

export async function runBacklinksLive(params: BacklinksLiveParams): Promise<{ result: BacklinksSkillResult; costUsd: number }> {
  const payload = await request("/v3/backlinks/summary/live", {
    method: "POST",
    body: JSON.stringify([{ target: params.domain }]),
  });
  const task = firstTask(payload);
  return {
    result: normalizeBacklinksResult(firstResult(task)),
    costUsd: finiteNumber(task.cost),
  };
}
