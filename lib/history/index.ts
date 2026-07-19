import type { Lens } from "@aeo/scoring";

export const HISTORY_KEY = "seo-ai-audit:history:v2";
export const LEGACY_HISTORY_KEY = "seo-ai-audit:history:v1";
export const HISTORY_CHANGED_EVENT = "seo-ai-audit:history-changed";
export const HISTORY_VERSION = 2;

export type AuditHistoryMode = "single" | "site";
export type AuditHistoryStatus = "started" | "complete" | "partial" | "failed";

export interface AuditHistoryRecord {
  id: string;
  version: typeof HISTORY_VERSION;
  url: string;
  finalUrl?: string;
  title: string;
  mode: AuditHistoryMode;
  createdAt: string;
  status: AuditHistoryStatus;
  scores: Record<Lens, number> | null;
  pageCount?: number;
}

export interface HistoryFilters {
  query?: string;
  mode?: "all" | AuditHistoryMode;
  sort?: "newest" | "oldest" | "highest" | "lowest";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScores(value: unknown): value is Record<Lens, number> {
  if (!isRecord(value)) return false;
  return ["aeo", "geo", "citability", "aiOverview"].every(
    (key) => typeof value[key] === "number" && Number.isFinite(value[key]),
  );
}

export function isHistoryRecord(value: unknown): value is AuditHistoryRecord {
  if (!isRecord(value)) return false;
  return (
    value.version === HISTORY_VERSION &&
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    typeof value.title === "string" &&
    (value.mode === "single" || value.mode === "site") &&
    (value.status === "started" || value.status === "complete" || value.status === "partial" || value.status === "failed") &&
    typeof value.createdAt === "string" &&
    !Number.isNaN(Date.parse(value.createdAt)) &&
    (value.scores === null || isScores(value.scores)) &&
    (value.finalUrl === undefined || typeof value.finalUrl === "string") &&
    (value.pageCount === undefined || (Number.isInteger(value.pageCount) && Number(value.pageCount) >= 0))
  );
}

export function loadHistory(storage: Pick<Storage, "getItem">): AuditHistoryRecord[] {
  try {
    const current = storage.getItem(HISTORY_KEY);
    if (current) {
      const parsed: unknown = JSON.parse(current);
      return Array.isArray(parsed) ? parsed.filter(isHistoryRecord) : [];
    }
    const raw = storage.getItem(LEGACY_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): AuditHistoryRecord[] => {
      if (!isRecord(value) || value.version !== 1) return [];
      const migrated = { ...value, version: HISTORY_VERSION };
      return isHistoryRecord(migrated) ? [migrated] : [];
    });
  } catch {
    return [];
  }
}

export function storeHistory(storage: Pick<Storage, "setItem">, records: AuditHistoryRecord[]): void {
  storage.setItem(HISTORY_KEY, JSON.stringify(records));
}

export function addHistoryRecord(
  records: AuditHistoryRecord[],
  record: AuditHistoryRecord,
  limit = 25,
): AuditHistoryRecord[] {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  return [record, ...records.filter((item) => item.id !== record.id)]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, safeLimit);
}

export function removeHistoryRecord(records: AuditHistoryRecord[], id: string): AuditHistoryRecord[] {
  return records.filter((record) => record.id !== id);
}

export function averageScore(record: AuditHistoryRecord): number | null {
  if (!record.scores) return null;
  const values = Object.values(record.scores);
  return Math.round(values.reduce((sum, score) => sum + score, 0) / values.length);
}

export function filterAndSortHistory(records: AuditHistoryRecord[], filters: HistoryFilters): AuditHistoryRecord[] {
  const query = filters.query?.trim().toLowerCase() ?? "";
  const filtered = records.filter((record) => {
    const modeMatches = !filters.mode || filters.mode === "all" || record.mode === filters.mode;
    const queryMatches = !query || `${record.title} ${record.url}`.toLowerCase().includes(query);
    return modeMatches && queryMatches;
  });
  const sort = filters.sort ?? "newest";
  return [...filtered].sort((a, b) => {
    if (sort === "oldest") return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (sort === "highest" || sort === "lowest") {
      const aScore = averageScore(a);
      const bScore = averageScore(b);
      if (aScore === null && bScore === null) return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      if (aScore === null) return 1;
      if (bScore === null) return -1;
      return sort === "highest" ? bScore - aScore : aScore - bScore;
    }
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

export function createHistoryId(mode: AuditHistoryMode, url: string, createdAt: string): string {
  return `${mode}:${url}:${createdAt}`;
}

export function notifyHistoryChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT));
}
