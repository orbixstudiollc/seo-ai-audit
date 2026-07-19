"use client";

import { useEffect, useId, useRef } from "react";
import { useLocalSettings } from "@/app/hooks/useLocalSettings";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { HISTORY_CHANGED_EVENT, HISTORY_KEY, LEGACY_HISTORY_KEY, LEGACY_HISTORY_V1_KEY } from "@/lib/history";
import { Button } from "./ui/Button";

type Props = { open: boolean; onClose: () => void; triggerRef: React.RefObject<HTMLButtonElement | null> };

export function SettingsDialog({ open, onClose, triggerRef }: Props) {
  const { settings, setSettings } = useLocalSettings();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  function clearHistory() {
    if (settings.confirmBeforeClear && !window.confirm("Clear all audit history from this browser?")) return;
    window.localStorage.removeItem(HISTORY_KEY);
    window.localStorage.removeItem(LEGACY_HISTORY_KEY);
    window.localStorage.removeItem(LEGACY_HISTORY_V1_KEY);
    window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT));
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-surface-1 p-5 shadow-xl focus:outline-none"
      >
        <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-3">Preferences</p>
            <h2 id={titleId} className="mt-1 text-xl font-semibold">Settings</h2>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className="flex flex-col gap-5 py-5 text-sm">
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">Default audit mode</span>
            <select className="h-10 border border-line-strong bg-surface-1 px-3" value={settings.defaultAuditMode} onChange={(e) => setSettings({ ...settings, defaultAuditMode: e.target.value as "single" | "site" })}>
              <option value="single">Single page</option>
              <option value="site">Whole site</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">History limit</span>
            <select className="h-10 border border-line-strong bg-surface-1 px-3" value={settings.historyLimit} onChange={(e) => setSettings({ ...settings, historyLimit: Number(e.target.value) as 10 | 25 | 50 })}>
              <option value="10">10 audits</option>
              <option value="25">25 audits</option>
              <option value="50">50 audits</option>
            </select>
          </label>
          <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={settings.autoSaveAudits} onChange={(e) => setSettings({ ...settings, autoSaveAudits: e.target.checked })} /><span><strong className="block">Save every audit query</strong><span className="text-text-2">Stores compact query status and score summaries only in this browser.</span></span></label>
          <label className="flex items-start gap-3"><input type="checkbox" className="mt-1" checked={settings.confirmBeforeClear} onChange={(e) => setSettings({ ...settings, confirmBeforeClear: e.target.checked })} /><span><strong className="block">Confirm before clearing history</strong><span className="text-text-2">Helps prevent accidental removal.</span></span></label>
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">Reduced motion</span>
            <select className="h-10 border border-line-strong bg-surface-1 px-3" value={settings.reducedMotion} onChange={(e) => setSettings({ ...settings, reducedMotion: e.target.value as "system" | "on" | "off" })}>
              <option value="system">Follow system</option><option value="on">On</option><option value="off">Off</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button size="sm" onClick={() => setSettings(DEFAULT_SETTINGS)}>Reset settings</Button>
          <Button size="sm" onClick={clearHistory}>Clear history</Button>
        </div>
        <p className="mt-5 text-xs leading-relaxed text-text-3">Preferences and audit history stay in this browser. Clearing browser data removes them. No account synchronization is enabled.</p>
      </div>
    </div>
  );
}
