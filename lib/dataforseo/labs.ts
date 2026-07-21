import type { LabsSkillResult } from "@/lib/skills/types";
import {
  DEFAULT_LANGUAGE_CODE,
  DEFAULT_LOCATION_CODE,
  array,
  finiteNumber,
  firstResult,
  firstTask,
  nullableNumber,
  record,
  request,
  text,
  type JsonRecord,
} from "./client";

/**
 * Ranked keywords lookup — /v3/dataforseo_labs/google/ranked_keywords/live,
 * limit 100. PAID.
 */
export const LABS_EST_COST_USD = 0.03;
export const LABS_LIMIT = 100;

export interface LabsLiveParams {
  /** Bare domain (no scheme), e.g. "example.com". */
  domain: string;
}

/** Normalizes ranked-keyword rows into the §8.1 typed payload. */
export function normalizeLabsResult(items: unknown[]): LabsSkillResult {
  const rows = items
    .flatMap((item) => {
      const rec = record(item);
      const keywordData = record(rec?.keyword_data);
      const keyword = text(keywordData?.keyword);
      if (!keyword) return [];
      const keywordInfo = record(keywordData?.keyword_info);
      const serpItem = record(record(rec?.ranked_serp_element)?.serp_item);
      return [{
        keyword,
        position: nullableNumber(serpItem?.rank_absolute),
        volume: nullableNumber(keywordInfo?.search_volume),
        url: serpItem && typeof serpItem.url === "string" ? serpItem.url : null,
      }];
    })
    .slice(0, LABS_LIMIT);
  return { rows };
}

export async function runLabsLive(params: LabsLiveParams): Promise<{ result: LabsSkillResult; costUsd: number }> {
  const payload = await request("/v3/dataforseo_labs/google/ranked_keywords/live", {
    method: "POST",
    body: JSON.stringify([{
      target: params.domain,
      language_code: DEFAULT_LANGUAGE_CODE,
      location_code: DEFAULT_LOCATION_CODE,
      limit: LABS_LIMIT,
    }]),
  });
  const task = firstTask(payload);
  const result: JsonRecord = firstResult(task);
  return {
    result: normalizeLabsResult(array(result.items)),
    costUsd: finiteNumber(task.cost),
  };
}
