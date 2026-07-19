"use client";

import { useState } from "react";
import type { SiteRollup } from "@/lib/audit/types";
import { LENS_ORDER, LENS_META } from "@/lib/audit/signalMeta";
import { Button } from "@/app/components/ui/Button";

type Props = { rootUrl: string; rollup: SiteRollup };

function markdown(rootUrl: string, rollup: SiteRollup): string {
  return [
    `# Site AI-search audit: ${rootUrl}`,
    "",
    `- Pages audited: ${rollup.pagesAudited}`,
    `- Pages failed: ${rollup.pagesFailed}`,
    "",
    "## Average scores",
    "",
    ...(rollup.avgScores ? LENS_ORDER.map((lens) => `- ${LENS_META[lens].name}: ${rollup.avgScores![lens]}/100`) : ["No pages completed scoring."]),
    "",
    "## Lowest-scoring pages",
    "",
    ...(rollup.worstPages.length ? rollup.worstPages.map((page) => `- ${page.overallScore}/100 — ${page.title || page.url} (${page.url})`) : ["No scored pages."]),
    "",
    "## Common findings",
    "",
    ...(rollup.commonFindings.length ? rollup.commonFindings.map((finding) => `- ${finding.issue} — ${finding.count} pages`) : ["No recurring findings."]),
    "",
  ].join("\n");
}

function download(filename: string, content: string, type: string) {
  const href = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

export function SiteReportActions({ rootUrl, rollup }: Props) {
  const [copied, setCopied] = useState(false);
  const host = new URL(rootUrl).hostname.replace(/[^a-z0-9.-]/gi, "-");
  const report = markdown(rootUrl, rollup);
  const shareUrl = typeof window === "undefined" ? "" : `${window.location.origin}/audit/site?url=${encodeURIComponent(rootUrl)}`;
  async function copyShare() {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <section aria-label="Export and share site report" className="rounded-[var(--radius-lg,5px)] border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto font-mono text-[10px] uppercase tracking-wider text-text-muted">Export & share</span>
        <Button size="sm" variant="outline" onClick={() => download(`${host}-site-audit.md`, report, "text/markdown;charset=utf-8")}>Markdown</Button>
        <Button size="sm" variant="outline" onClick={() => download(`${host}-site-audit.json`, JSON.stringify(rollup, null, 2), "application/json;charset=utf-8")}>Rollup JSON</Button>
        <Button size="sm" onClick={copyShare}>Copy share link</Button>
      </div>
      <p aria-live="polite" className="mt-2 min-h-4 text-[11px] text-text-muted">
        {copied ? "Share link copied. Opening it runs a fresh site audit." : "Exports are generated locally from this summary."}
      </p>
    </section>
  );
}
