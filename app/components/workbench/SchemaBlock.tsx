"use client";

import { useState } from "react";
import { Button } from "@/app/components/ui/Button";

type Props = {
  json: string | null;
};

/**
 * Copy-paste JSON-LD block, templated in code from the audit's Q/A pairs.
 * One-click copy; monospace; ready to drop into a <script type="application/ld+json">.
 */
export function SchemaBlock({ json }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!json) return;
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  if (!json) {
    return (
      <p className="px-4 py-6 text-center text-[13px] text-text-3">
        FAQ schema is generated from the Q/A pairs the audit extracts. Run an audit to produce copy-paste JSON-LD.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-3">FAQPage · application/ld+json</span>
        <Button size="sm" variant="outline" onClick={handleCopy} aria-live="polite">
          {copied ? "Copied ✓" : "Copy"}
        </Button>
      </div>
      <pre className="max-h-80 overflow-auto rounded-[var(--radius,3px)] border border-line bg-surface-3 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-text-1">
        <code>{json}</code>
      </pre>
    </div>
  );
}
