import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, isAppSettings, loadSettings } from "./index";

describe("local settings", () => {
  it("loads valid settings through the 500-audit limit", () => { const value = { ...DEFAULT_SETTINGS, defaultAuditMode: "site" as const, historyLimit: 500 as const }; expect(loadSettings({ getItem: () => JSON.stringify(value) })).toEqual(value); });
  it("falls back for corrupt or outdated settings", () => { expect(loadSettings({ getItem: () => "{" })).toEqual(DEFAULT_SETTINGS); expect(loadSettings({ getItem: () => JSON.stringify({ ...DEFAULT_SETTINGS, version: 2 }) })).toEqual(DEFAULT_SETTINGS); });
  it("validates every preference", () => { expect(isAppSettings(DEFAULT_SETTINGS)).toBe(true); expect(isAppSettings({ ...DEFAULT_SETTINGS, historyLimit: 12 })).toBe(false); });
});
