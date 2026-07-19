export const SETTINGS_KEY = "seo-ai-audit:settings:v1";
export const SETTINGS_CHANGED_EVENT = "seo-ai-audit:settings-changed";
export const SETTINGS_VERSION = 1;

export interface AppSettings {
  version: typeof SETTINGS_VERSION;
  defaultAuditMode: "single" | "site";
  historyLimit: 10 | 25 | 50;
  confirmBeforeClear: boolean;
  autoSaveAudits: boolean;
  reducedMotion: "system" | "on" | "off";
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  defaultAuditMode: "single",
  historyLimit: 25,
  confirmBeforeClear: true,
  autoSaveAudits: true,
  reducedMotion: "system",
};

export function isAppSettings(value: unknown): value is AppSettings {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    item.version === SETTINGS_VERSION &&
    (item.defaultAuditMode === "single" || item.defaultAuditMode === "site") &&
    (item.historyLimit === 10 || item.historyLimit === 25 || item.historyLimit === 50) &&
    typeof item.confirmBeforeClear === "boolean" &&
    typeof item.autoSaveAudits === "boolean" &&
    (item.reducedMotion === "system" || item.reducedMotion === "on" || item.reducedMotion === "off")
  );
}

export function loadSettings(storage: Pick<Storage, "getItem">): AppSettings {
  try {
    const raw = storage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    return isAppSettings(parsed) ? parsed : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function storeSettings(storage: Pick<Storage, "setItem">, settings: AppSettings): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function notifySettingsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SETTINGS_CHANGED_EVENT));
}

