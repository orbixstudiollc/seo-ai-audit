import { type ApiKeyProvider } from "./types";

/**
 * Client-only audit-provider preference, persisted in localStorage. The single
 * owner of the storage key so the settings picker (which writes it) and the
 * workbench (which reads it when kicking off an audit) can never drift apart.
 *
 * There is no server column for this (audits are started client-side and this
 * is a pure per-browser preference), so it lives in localStorage and rides
 * along on the audit POST. The server still validates the chosen provider
 * against the user's stored keys and falls back to a sensible default, so a
 * stale or absent value is always safe.
 */

export const AUDIT_PROVIDER_STORAGE_KEY = "aeo:auditProvider";
export const AUDIT_PROVIDER_STORAGE_EVENT = "aeo:auditProvider-change";

/** The one narrowing check for "is this stored string a real provider" — every reader of the preference must go through this, not re-derive it, or a future provider addition silently drifts out of sync (as happened when "custom" was added). */
export function isProvider(value: string | null): value is ApiKeyProvider {
  return value === "openai" || value === "anthropic" || value === "custom";
}

/** Subscribe for `useSyncExternalStore` — fires on cross-tab `storage` and same-tab writes. */
export function subscribeAuditProvider(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(AUDIT_PROVIDER_STORAGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(AUDIT_PROVIDER_STORAGE_EVENT, callback);
  };
}

/** Raw client snapshot for `useSyncExternalStore` (may be a stale/removed provider — callers guard). */
export function getAuditProviderSnapshot(): string | null {
  return window.localStorage.getItem(AUDIT_PROVIDER_STORAGE_KEY);
}

/** Server snapshot for `useSyncExternalStore` — deterministic null so SSR never reads localStorage. */
export function getAuditProviderServerSnapshot(): null {
  return null;
}

/** Read the preferred provider on demand (e.g. when starting an audit). Null when unset or off-browser. */
export function readAuditProvider(): ApiKeyProvider | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(AUDIT_PROVIDER_STORAGE_KEY);
  return isProvider(value) ? value : null;
}

/** Persist the preferred provider and notify same-tab subscribers. */
export function writeAuditProvider(provider: ApiKeyProvider): void {
  window.localStorage.setItem(AUDIT_PROVIDER_STORAGE_KEY, provider);
  window.dispatchEvent(new Event(AUDIT_PROVIDER_STORAGE_EVENT));
}
