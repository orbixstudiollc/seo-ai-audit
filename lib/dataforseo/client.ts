import type {
  PolledOnPageTask,
  StartedOnPageTask,
  TechnicalSeoPage,
  TechnicalSeoResult,
} from "./types";

const DEFAULT_BASE_URL = "https://api.dataforseo.com";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 8_000_000;

// ponytail: fixed en/US locale for every paid lookup (serp/keywords/labs) —
// no per-audit locale setting exists yet. Upgrade path: thread a locale
// through SkillScope once a non-US audience needs it.
export const DEFAULT_LANGUAGE_CODE = "en";
export const DEFAULT_LOCATION_CODE = 2840;

export type JsonRecord = Record<string, unknown>;

// Shared shape-defensive parsing + envelope helpers, reused by the paid
// SK2 modules (serp/keywords/labs/backlinks) so they extend this client
// instead of forking their own copies (record/text/finiteNumber, DFS
// tasks[]/result[] envelope unwrapping).

export function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function firstTask(payload: JsonRecord): JsonRecord {
  const task = record(array(payload.tasks)[0]);
  const topStatus = finiteNumber(payload.status_code);
  const taskStatus = finiteNumber(task?.status_code);
  if (!task || topStatus !== 20_000 || taskStatus >= 40_000) {
    throw new Error("DataForSEO rejected the request.");
  }
  return task;
}

export function firstResult(task: JsonRecord): JsonRecord {
  return record(array(task.result)[0]) ?? {};
}

function configuredCredentials(): { login: string; password: string } | null {
  const login = process.env.DATAFORSEO_LOGIN?.trim();
  const password = process.env.DATAFORSEO_PASSWORD?.trim();
  return login && password ? { login, password } : null;
}

export function dataForSeoConfigured(): boolean {
  return configuredCredentials() !== null;
}

export async function request(path: string, init: RequestInit): Promise<JsonRecord> {
  const credentials = configuredCredentials();
  if (!credentials) throw new Error("DataForSEO is not configured.");
  const baseUrl = (process.env.DATAFORSEO_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${Buffer.from(`${credentials.login}:${credentials.password}`).toString("base64")}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE_BYTES) throw new Error("DataForSEO returned an oversized response.");
    if (!response.ok) throw new Error("DataForSEO request failed.");
    const payload = record(JSON.parse(raw) as unknown);
    if (!payload) throw new Error("DataForSEO returned an invalid response.");
    return payload;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("DataForSEO request timed out.");
    if (error instanceof Error && error.message.startsWith("DataForSEO")) throw error;
    throw new Error("DataForSEO request failed.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function startOnPageTask(input: {
  target: string;
  maxCrawlPages: number;
}): Promise<StartedOnPageTask> {
  const payload = await request("/v3/on_page/task_post", {
    method: "POST",
    body: JSON.stringify([{
      target: input.target,
      max_crawl_pages: input.maxCrawlPages,
      respect_sitemap: true,
      crawl_sitemap_only: false,
      load_resources: false,
      enable_javascript: false,
      enable_browser_rendering: false,
    }]),
  });
  const task = firstTask(payload);
  const taskId = text(task.id);
  if (!taskId) throw new Error("DataForSEO did not return a task identifier.");
  return { taskId, costUsd: finiteNumber(task.cost) };
}

function normalizePage(value: unknown): TechnicalSeoPage | null {
  const item = record(value);
  if (!item) return null;
  const url = text(item.url);
  if (!url) return null;
  const meta = record(item.meta);
  const checks = record(item.checks);
  const issueKeys = checks
    ? Object.entries(checks).filter(([, enabled]) => enabled === true).map(([key]) => key).slice(0, 60)
    : [];
  return {
    url,
    statusCode: nullableNumber(item.status_code),
    title: text(meta?.title).slice(0, 500),
    onpageScore: nullableNumber(item.onpage_score),
    clickDepth: nullableNumber(item.click_depth),
    issueKeys,
  };
}

function normalizeSummary(value: JsonRecord, pages: TechnicalSeoPage[]): TechnicalSeoResult {
  const crawlStatus = record(value.crawl_status);
  return {
    target: text(value.target),
    crawlProgress: value.crawl_progress === "finished" ? "finished" : "in_progress",
    maxCrawlPages: finiteNumber(crawlStatus?.max_crawl_pages),
    pagesCrawled: finiteNumber(crawlStatus?.pages_crawled),
    pagesInQueue: finiteNumber(crawlStatus?.pages_in_queue),
    onpageScore: nullableNumber(value.onpage_score),
    pages,
  };
}

export async function pollOnPageTask(taskId: string, pageLimit: number): Promise<PolledOnPageTask> {
  const summaryPayload = await request(`/v3/on_page/summary/${encodeURIComponent(taskId)}`, { method: "GET" });
  const summary = firstResult(firstTask(summaryPayload));
  if (summary.crawl_progress !== "finished") {
    return { status: "running", result: normalizeSummary(summary, []) };
  }

  const pagesPayload = await request("/v3/on_page/pages", {
    method: "POST",
    body: JSON.stringify([{
      id: taskId,
      limit: Math.max(1, Math.min(500, Math.floor(pageLimit))),
      filters: ["resource_type", "=", "html"],
    }]),
  });
  const pagesResult = firstResult(firstTask(pagesPayload));
  const pages = array(pagesResult.items).flatMap((item) => normalizePage(item) ?? []);
  return { status: "complete", result: normalizeSummary(summary, pages) };
}
