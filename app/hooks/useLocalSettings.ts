"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  notifySettingsChanged,
  SETTINGS_CHANGED_EVENT,
  storeSettings,
  type AppSettings,
} from "@/lib/settings";
import { loadCloudSettings, saveCloudSettings } from "@/lib/cloud/settings";
import { ACCOUNT_OWNER_CHANGED_EVENT } from "@/lib/auth/events";

export function useLocalSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setSettingsState(loadSettings(window.localStorage));
    const syncCloud = () => {
      void loadCloudSettings().then((result) => {
        if (result.state === "found") {
          storeSettings(window.localStorage, result.settings);
          setSettingsState(result.settings);
          notifySettingsChanged();
        } else if (result.state === "missing") {
          void saveCloudSettings(loadSettings(window.localStorage));
        }
      });
    };
    queueMicrotask(() => {
      sync();
      setReady(true);
      syncCloud();
    });
    window.addEventListener(SETTINGS_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    window.addEventListener(ACCOUNT_OWNER_CHANGED_EVENT, syncCloud);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener(ACCOUNT_OWNER_CHANGED_EVENT, syncCloud);
    };
  }, []);

  const setSettings = useCallback((next: AppSettings) => {
    storeSettings(window.localStorage, next);
    setSettingsState(next);
    notifySettingsChanged();
    void saveCloudSettings(next);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.reducedMotion === "system") delete root.dataset.reducedMotion;
    else root.dataset.reducedMotion = settings.reducedMotion;
  }, [settings.reducedMotion]);

  return { settings, setSettings, ready };
}
