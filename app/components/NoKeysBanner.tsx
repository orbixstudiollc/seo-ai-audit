"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * First-run callout on the docs list, shown while the user has no stored API
 * keys (audits are BYOK, so nothing can run until a key exists). Dismissible
 * for the session; it reappears on reload until a key is added.
 */
export function NoKeysBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-4 border border-line bg-surface-2 px-4 py-3"
    >
      <p className="text-sm text-text-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-accent-ink">Setup</span>{" "}
        Add your API key in{" "}
        <Link
          href="/app/settings"
          className="font-semibold text-accent-ink underline underline-offset-2"
        >
          Settings
        </Link>{" "}
        to run audits.
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        className="shrink-0 px-1 font-mono text-sm text-text-3 transition-colors hover:text-text-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-ink"
      >
        ×
      </button>
    </div>
  );
}
