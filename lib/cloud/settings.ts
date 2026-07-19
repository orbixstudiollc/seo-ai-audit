import { isAppSettings, type AppSettings } from "@/lib/settings";
import { cloudFetch } from "./request";

export type CloudSettingsResult =
  | { state: "found"; settings: AppSettings }
  | { state: "missing" | "unavailable" };

export async function loadCloudSettings(): Promise<CloudSettingsResult> {
  try {
    const response = await cloudFetch("/api/settings", { method: "GET" });
    if (response.status === 404) return { state: "missing" };
    if (!response.ok) return { state: "unavailable" };
    const body = await response.json() as { settings?: unknown };
    return isAppSettings(body.settings) ? { state: "found", settings: body.settings } : { state: "unavailable" };
  } catch { return { state: "unavailable" }; }
}

export async function saveCloudSettings(settings: AppSettings): Promise<boolean> {
  try {
    const response = await cloudFetch("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ settings }),
    });
    return response.ok;
  } catch { return false; }
}
