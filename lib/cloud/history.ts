import type { AuditHistoryRecord } from "@/lib/history";
import type { SavedAuditReport } from "@/lib/reports";
import { CLOUD_OWNER_HEADER, getCloudOwnerToken } from "./owner";

export type CloudSyncState = "syncing" | "synced" | "local";
export const CLOUD_MIGRATION_KEY = "seo-ai-audit:cloud-migration:v1";

interface CloudHistoryResponse {
  records: AuditHistoryRecord[];
}

function ownerHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    [CLOUD_OWNER_HEADER]: getCloudOwnerToken(window.localStorage),
  };
}

async function cloudRequest(path: string, init: RequestInit): Promise<Response> {
  return fetch(path, { ...init, headers: { ...ownerHeaders(), ...init.headers }, cache: "no-store" });
}

export async function loadCloudHistory(): Promise<AuditHistoryRecord[] | null> {
  try {
    const response = await cloudRequest("/api/history", { method: "GET" });
    if (!response.ok) return null;
    const body = await response.json() as CloudHistoryResponse;
    return Array.isArray(body.records) ? body.records : null;
  } catch {
    return null;
  }
}

export async function migrateHistoryRecords(records: AuditHistoryRecord[]): Promise<boolean> {
  if (records.length === 0) return true;
  try {
    const response = await cloudRequest("/api/history", {
      method: "PUT",
      body: JSON.stringify({ records: records.slice(0, 500) }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function saveCloudAudit(record: AuditHistoryRecord, report?: SavedAuditReport): Promise<boolean> {
  try {
    const response = await cloudRequest("/api/history", {
      method: "PUT",
      body: JSON.stringify({ records: [record], ...(report ? { report } : {}) }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function loadCloudAuditReport(id: string): Promise<SavedAuditReport | null> {
  try {
    const response = await cloudRequest("/api/history", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
    if (!response.ok) return null;
    const body = await response.json() as { report?: SavedAuditReport };
    return body.report ?? null;
  } catch {
    return null;
  }
}

export async function deleteCloudAudit(id: string): Promise<boolean> {
  try {
    const response = await cloudRequest("/api/history", { method: "DELETE", body: JSON.stringify({ id }) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function clearCloudHistory(): Promise<boolean> {
  try {
    const response = await cloudRequest("/api/history", { method: "DELETE", body: JSON.stringify({ all: true }) });
    return response.ok;
  } catch {
    return false;
  }
}
