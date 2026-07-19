import type { AuditErrorKind, AuditReport, SiteAuditStreamPhase } from "@/lib/audit/types";
import type { SiteAuditStreamState } from "@/app/hooks/useSiteAuditStream";

const DB_NAME = "seo-ai-audit:reports";
const STORE_NAME = "reports";
const DB_VERSION = 1;
export const SAVED_REPORT_VERSION = 1;

export interface SavedSingleReport {
  version: typeof SAVED_REPORT_VERSION;
  id: string;
  kind: "single";
  createdAt: string;
  phase: "done" | "error";
  report: AuditReport;
  error: { kind: AuditErrorKind; message: string; retryAfter?: number } | null;
}

export interface SavedSiteReport {
  version: typeof SAVED_REPORT_VERSION;
  id: string;
  kind: "site";
  createdAt: string;
  phase: Extract<SiteAuditStreamPhase, "done" | "error">;
  state: Omit<SiteAuditStreamState, "phase">;
}

export type SavedAuditReport = SavedSingleReport | SavedSiteReport;

function openReportsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open saved reports."));
  });
}

function runTransaction(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => void): Promise<void> {
  return openReportsDb().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    operation(transaction.objectStore(STORE_NAME));
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error("Saved report operation failed.")); };
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error("Saved report operation was aborted.")); };
  }));
}

function isSavedReport(value: unknown): value is SavedAuditReport {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (item.version !== SAVED_REPORT_VERSION || typeof item.id !== "string" || typeof item.createdAt !== "string") return false;
  if (item.kind === "single") return (item.phase === "done" || item.phase === "error") && !!item.report && typeof item.report === "object";
  if (item.kind === "site") return (item.phase === "done" || item.phase === "error") && !!item.state && typeof item.state === "object";
  return false;
}

export function saveAuditReport(report: SavedAuditReport): Promise<void> {
  return runTransaction("readwrite", (store) => { store.put(report); });
}

export async function loadAuditReport(id: string): Promise<SavedAuditReport | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const database = await openReportsDb();
    return await new Promise((resolve) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
      request.onsuccess = () => { database.close(); resolve(isSavedReport(request.result) ? request.result : null); };
      request.onerror = () => { database.close(); resolve(null); };
    });
  } catch { return null; }
}

export function deleteAuditReport(id: string): Promise<void> {
  return runTransaction("readwrite", (store) => { store.delete(id); });
}

export function pruneAuditReports(keepIds: ReadonlySet<string>): Promise<void> {
  return runTransaction("readwrite", (store) => {
    const request = store.openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (typeof cursor.key === "string" && !keepIds.has(cursor.key)) store.delete(cursor.key);
      cursor.continue();
    };
  });
}

export async function clearAuditReports(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await runTransaction("readwrite", (store) => { store.clear(); });
}
