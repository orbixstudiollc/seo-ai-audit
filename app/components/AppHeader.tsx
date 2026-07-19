"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { SettingsDialog } from "./SettingsDialog";
import { AccountDialog } from "./account/AccountDialog";
import { useAccount } from "./account/AccountProvider";

export function AppHeader() {
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const account = useAccount();
  const navClass = (active: boolean) => `font-mono text-xs uppercase tracking-wider ${active ? "text-accent-ink underline underline-offset-4" : "text-text-2 hover:text-text-1"}`;

  return (
    <>
      <header className="border-b border-line px-4 py-3 sm:px-6">
        <nav aria-label="Main navigation" className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 sm:flex-nowrap sm:gap-4">
          <Link href="/" className="font-mono text-sm font-semibold uppercase tracking-[0.16em] text-text-1 hover:text-accent-ink">SEO AI Audit</Link>
          <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end sm:gap-5">
            <Link href="/" className={navClass(pathname === "/")}>New audit</Link>
            <Link href="/dashboard" className={navClass(pathname === "/dashboard")}>Dashboard</Link>
            <button ref={accountTriggerRef} type="button" onClick={() => setAccountOpen(true)} className="font-mono text-xs uppercase tracking-wider text-text-2 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink">{account.email ? "Account" : "Sign in"}</button>
            <button ref={settingsTriggerRef} type="button" onClick={() => setSettingsOpen(true)} className="font-mono text-xs uppercase tracking-wider text-text-2 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink">Settings</button>
          </div>
        </nav>
      </header>
      <AccountDialog open={accountOpen} onClose={() => setAccountOpen(false)} triggerRef={accountTriggerRef} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} triggerRef={settingsTriggerRef} />
    </>
  );
}
