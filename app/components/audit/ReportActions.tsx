"use client";

import { useMemo, useState } from "react";
import type { AuditReport } from "@/lib/audit/types";
import { buildAuditExportBundle } from "@/lib/export/report";
import { Button } from "@/app/components/ui/Button";

type Props = { report: AuditReport };
type Notice = "link" | "schema" | null;

function safeFilename(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return slug || "seo-ai-audit";
}

function download(filename: string, content: string, type: string) {
  const href = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

export function ReportActions({ report }: Props) {
  const bundle = useMemo(() => buildAuditExportBundle(report), [report]);
  const [notice, setNotice] = useState<Notice>(null);
  const base = safeFilename(report.page.title);

  async function copy(value: string, kind: Exclude<Notice, null>) {
    await navigator.clipboard.writeText(value);
    setNotice(kind);
    window.setTimeout(() => setNotice(null), 1800);
  }

  const shareUrl = typeof window === "undefined"
    ? ""
    : `${window.location.origin}/audit?url=${encodeURIComponent(report.page.finalUrl)}`;

  return (
    <section aria-label="Export and share" className="rounded-[var(--radius-lg,5px)] border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto font-mono text-[10px] uppercase tracking-wider text-text-muted">Export & share</span>
        <Button size="sm" variant="outline" onClick={() => download(`${base}.md`, bundle.markdown, "text/markdown;charset=utf-8")}>Markdown</Button>
        <Button size="sm" variant="outline" onClick={() => download(`${base}.html`, bundle.html, "text/html;charset=utf-8")}>HTML</Button>
        <Button size="sm" variant="outline" onClick={() => download(`${base}-scores.json`, bundle.scoresJson, "application/json;charset=utf-8")}>Scores JSON</Button>
        {bundle.jsonLd && <Button size="sm" variant="outline" onClick={() => copy(bundle.jsonLd!, "schema")}>Copy FAQ schema</Button>}
        <Button size="sm" onClick={() => copy(shareUrl, "link")}>Copy share link</Button>
      </div>
      <p aria-live="polite" className="mt-2 min-h-4 text-[11px] text-text-muted">
        {notice === "link" ? "Share link copied. Opening it runs a fresh audit." : notice === "schema" ? "FAQ JSON-LD copied." : "Exports are generated locally from this report."}
      </p>
    </section>
  );
}
