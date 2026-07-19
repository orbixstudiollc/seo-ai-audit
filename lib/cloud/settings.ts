import { isAppSettings, type AppSettings } from "@/lib/settings";
import { CLOUD_OWNER_HEADER, getCloudOwnerToken } from "./owner";

export type CloudSettingsResult =
  | { state: "found"; settings: AppSettings }
  | { state: "missing" | "unavailable" };

function headers(): HeadersInit {
  return { "Content-Type": "application/json", [CLOUD_OWNER_HEADER]: getCloudOwnerToken(window.localStorage) };
}

export async function loadCloudSettings(): Promise<CloudSettingsResult> {
  try {
    const response = await fetch("/api/settings", { method: "GET", headers: headers(), cache: "no-store" });
    if (response.status === 404) return { state: "missing" };
    if (!response.ok) return { state: "unavailable" };
    const body = await response.json() as { settings?: unknown };
    return isAppSettings(body.settings) ? { state: "found", settings: body.settings } : { state: "unavailable" };
  } catch { return { state: "unavailable" }; }
}

export async function saveCloudSettings(settings: AppSettings): Promise<boolean> {
  try {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ settings }),
      cache: "no-store",
    });
    return response.ok;
  } catch { return false; }
}

