import type { KeywordsSkillResult } from "@/lib/skills/types";
import {
  DEFAULT_LANGUAGE_CODE,
  DEFAULT_LOCATION_CODE,
  array,
  finiteNumber,
  firstTask,
  nullableNumber,
  record,
  request,
  text,
} from "./client";

/**
 * Search volume lookup — /v3/keywords_data/google_ads/search_volume/live,
 * ≤100 keywords per call. PAID.
 */
export const KEYWORDS_EST_COST_USD = 0.08;
export const MAX_KEYWORDS = 100;

export interface KeywordsLiveParams {
  keywords: string[];
}

/** Normalizes the Google Ads search-volume rows into the §8.1 typed payload. */
export function normalizeKeywordsResult(items: unknown[]): KeywordsSkillResult {
  const rows = items
    .flatMap((item) => {
      const rec = record(item);
      const keyword = text(rec?.keyword);
      if (!keyword) return [];
      return [{
        keyword,
        volume: nullableNumber(rec?.search_volume),
        cpc: nullableNumber(rec?.cpc),
        competition: nullableNumber(rec?.competition_index),
      }];
    })
    .slice(0, MAX_KEYWORDS);
  return { rows };
}

export async function runKeywordsLive(params: KeywordsLiveParams): Promise<{ result: KeywordsSkillResult; costUsd: number }> {
  const keywords = params.keywords.slice(0, MAX_KEYWORDS);
  const payload = await request("/v3/keywords_data/google_ads/search_volume/live", {
    method: "POST",
    body: JSON.stringify([{
      keywords,
      language_code: DEFAULT_LANGUAGE_CODE,
      location_code: DEFAULT_LOCATION_CODE,
    }]),
  });
  const task = firstTask(payload);
  return {
    result: normalizeKeywordsResult(array(task.result)),
    costUsd: finiteNumber(task.cost),
  };
}
