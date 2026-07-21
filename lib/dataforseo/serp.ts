import type { SerpSkillResult } from "@/lib/skills/types";
import {
  DEFAULT_LANGUAGE_CODE,
  DEFAULT_LOCATION_CODE,
  array,
  finiteNumber,
  firstResult,
  firstTask,
  record,
  request,
  text,
  type JsonRecord,
} from "./client";

/**
 * SERP live lookup — /v3/serp/google/organic/live/advanced, depth 20.
 * PAID (EST_COST_USD below is the pessimistic per-call reservation; actual
 * cost settles from the provider's returned `cost`).
 */
export const SERP_EST_COST_USD = 0.01;
const SERP_DEPTH = 20;
const MAX_ENTRIES = 20;

export interface SerpLiveParams {
  keyword: string;
  /** Own site's host (already normalized, no "www."), used to flag isOwn. */
  ownHost: string;
}

/** Normalizes one organic SERP result set into the §8.1 typed payload. */
export function normalizeSerpResult(result: JsonRecord, keyword: string, ownHost: string): SerpSkillResult {
  const entries = array(result.items)
    .flatMap((item) => {
      const rec = record(item);
      if (!rec || rec.type !== "organic") return [];
      const url = text(rec.url);
      if (!url) return [];
      let domain = "";
      try {
        domain = new URL(url).hostname.replace(/^www\./i, "");
      } catch {
        return [];
      }
      return [{
        rank: finiteNumber(rec.rank_absolute ?? rec.rank_group),
        url,
        title: text(rec.title).slice(0, 300),
        domain,
        isOwn: domain === ownHost,
      }];
    })
    .slice(0, MAX_ENTRIES);
  return { keyword, capturedAt: new Date().toISOString(), entries };
}

export async function runSerpLive(params: SerpLiveParams): Promise<{ result: SerpSkillResult; costUsd: number }> {
  const payload = await request("/v3/serp/google/organic/live/advanced", {
    method: "POST",
    body: JSON.stringify([{
      keyword: params.keyword,
      depth: SERP_DEPTH,
      language_code: DEFAULT_LANGUAGE_CODE,
      location_code: DEFAULT_LOCATION_CODE,
    }]),
  });
  const task = firstTask(payload);
  const result = firstResult(task);
  return {
    result: normalizeSerpResult(result, params.keyword, params.ownHost),
    costUsd: finiteNumber(task.cost),
  };
}
