"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useAccount } from "./AccountProvider";
import { Button } from "@/app/components/ui/Button";

type Props = { open: boolean; onClose: () => void; triggerRef: React.RefObject<HTMLButtonElement | null> };

export function AccountDialog({ open, onClose, triggerRef }: Props) {
  const account = useAccount();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); trigger?.focus(); };
  }, [onClose, open, triggerRef]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage(null);
    const result = await account.sendMagicLink(email.trim());
    setMessage(result.message); setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-surface-1 p-5 shadow-xl focus:outline-none">
        <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
          <div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-3">Cloud workspace</p><h2 id={titleId} className="mt-1 text-xl font-semibold">Account</h2></div>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>

        {account.loading ? <p className="wb-skeleton py-5 text-sm text-text-3">Checking account…</p> : account.email ? (
          <div className="py-5">
            <p className="text-sm font-medium text-text-1">Signed in</p>
            <p className="mt-1 break-all font-mono text-xs text-text-2">{account.email}</p>
            <p className="mt-3 text-xs leading-relaxed text-text-3">Your current anonymous audits have been linked to this account. Dashboard history, reports, settings, and technical crawl data can follow you across devices.</p>
            <Button className="mt-5" size="sm" onClick={() => void account.signOut()}>Sign out</Button>
          </div>
        ) : (
          <form className="py-5" onSubmit={(event) => void submit(event)}>
            <p className="text-sm leading-relaxed text-text-2">Sign in with a secure email link to recover this workspace on another device. Auditing remains available without an account.</p>
            <label className="mt-5 flex flex-col gap-1.5"><span className="text-sm font-medium">Email address</span><input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="h-10 border border-line-strong bg-surface-1 px-3 text-sm text-text-1" /></label>
            <Button className="mt-3" size="sm" type="submit" disabled={busy || !account.configured}>{busy ? "Sending…" : "Email sign-in link"}</Button>
            {!account.configured && <p className="mt-3 text-xs text-text-3">Account sign-in is not configured for this deployment.</p>}
            {message && <p role="status" className="mt-3 text-xs text-text-2">{message}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
