"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { SettingsDialog } from "./SettingsDialog";

export function AppHeader() {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navClass = (active: boolean) => `font-mono text-xs uppercase tracking-wider ${active ? "text-accent-ink underline underline-offset-4" : "text-text-2 hover:text-text-1"}`;

  return (
    <>
      <header className="border-b border-line px-4 py-3 sm:px-6">
        <nav aria-label="Main navigation" className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link href="/" className="font-mono text-sm font-semibold uppercase tracking-[0.16em] text-text-1 hover:text-accent-ink">SEO AI Audit</Link>
          <div className="flex items-center gap-3 sm:gap-5">
            <Link href="/" className={navClass(pathname === "/")}>New audit</Link>
            <Link href="/dashboard" className={navClass(pathname === "/dashboard")}>Dashboard</Link>
            <button ref={triggerRef} type="button" onClick={() => setSettingsOpen(true)} className="font-mono text-xs uppercase tracking-wider text-text-2 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink">Settings</button>
          </div>
        </nav>
      </header>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} triggerRef={triggerRef} />
    </>
  );
}

