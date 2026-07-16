"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { WorkbenchAudit, WorkbenchDocument } from "@/lib/audit/types";
import { buildExportBundle, type ExportBundle } from "@/lib/export";

/**
 * Self-contained export disclosure for the workbench. Assembles the export
 * bundle from lib/export (pure/isomorphic — no server round-trip needed) and
 * triggers downloads via Blob object-URLs. The assembly + file-descriptor
 * helpers are exported for unit tests; the component is just wiring.
 */

export type ExportMenuProps = {
  document: WorkbenchDocument;
  audit: WorkbenchAudit;
  /** Ids of the rewrite hunks the user accepted in the workbench. */
  acceptedRewriteIds: readonly string[];
  /** The editor's current working content (accepted hunks + manual edits). */
  workingContent: string;
};

/**
 * Build the bundle off the WORKING content, not the stored document, so
 * manual editor tweaks survive into the export. Accepted hunks already
 * applied to the working content are skipped by buildOptimizedMarkdown
 * (their before-text is gone), so passing the ids too is safe either way.
 */
export function buildWorkbenchExportBundle({
  document,
  audit,
  acceptedRewriteIds,
  workingContent,
}: ExportMenuProps): ExportBundle {
  return buildExportBundle({
    document: { ...document, rawContent: workingContent },
    audit,
    acceptedRewriteIds,
  });
}

export interface ExportFile {
  filename: string;
  mime: string;
  content: string;
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug !== "" ? slug : "export";
}

export interface ExportFiles {
  markdown: ExportFile;
  html: ExportFile;
  roadmap: ExportFile;
  scores: ExportFile;
}

export function exportFilesFor(title: string, bundle: ExportBundle): ExportFiles {
  const slug = slugify(title);
  return {
    markdown: {
      filename: `${slug}.md`,
      mime: "text/markdown",
      content: bundle.optimizedMarkdown,
    },
    html: { filename: `${slug}.html`, mime: "text/html", content: bundle.optimizedHtml },
    roadmap: {
      filename: `${slug}-roadmap.md`,
      mime: "text/markdown",
      content: bundle.roadmapMarkdown,
    },
    scores: {
      filename: `${slug}-scores.json`,
      mime: "application/json",
      content: bundle.scoresJson,
    },
  };
}

function downloadFile(file: ExportFile): void {
  const blob = new Blob([file.content], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = file.filename;
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ExportMenu(props: ExportMenuProps) {
  const { document: doc, audit } = props;
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const canExport = audit.scores !== null;
  const hasJsonLd = (audit.findings?.qaPairs.length ?? 0) > 0;

  // Light dismissal: click outside closes; Escape is handled on the wrapper.
  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    window.document.addEventListener("pointerdown", onPointerDown);
    return () => window.document.removeEventListener("pointerdown", onPointerDown);
  }, [isOpen]);

  function withBundle(action: (files: ExportFiles) => void): void {
    const bundle = buildWorkbenchExportBundle(props);
    action(exportFilesFor(doc.title, bundle));
    setIsOpen(false);
  }

  async function handleCopyJsonLd() {
    const bundle = buildWorkbenchExportBundle(props);
    if (bundle.jsonLd === null) return;
    try {
      await navigator.clipboard.writeText(bundle.jsonLd);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
        setIsOpen(false);
      }, 1200);
    } catch {
      setCopied(false);
    }
  }

  const items: Array<{ label: string; disabled?: boolean; onSelect: () => void }> = [
    { label: "Download optimized .md", onSelect: () => withBundle((f) => downloadFile(f.markdown)) },
    { label: "Download .html + JSON-LD", onSelect: () => withBundle((f) => downloadFile(f.html)) },
    {
      label: copied ? "Copied ✓" : "Copy JSON-LD",
      disabled: !hasJsonLd,
      onSelect: () => void handleCopyJsonLd(),
    },
    { label: "Download roadmap .md", onSelect: () => withBundle((f) => downloadFile(f.roadmap)) },
    { label: "Download scores .json", onSelect: () => withBundle((f) => downloadFile(f.scores)) },
  ];

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && isOpen) {
          event.stopPropagation();
          setIsOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      {/* Plain button (not ui/Button) because the Escape handler needs a ref
          to restore focus, and ui/Button's props don't forward one. Styles
          mirror ui/Button's outline/sm variant. */}
      <button
        ref={triggerRef}
        type="button"
        disabled={!canExport}
        aria-expanded={isOpen}
        aria-controls={menuId}
        aria-haspopup="true"
        title={canExport ? undefined : "Run an audit first — exports need scores."}
        onClick={() => setIsOpen((open) => !open)}
        className="inline-flex h-7 select-none items-center justify-center gap-2 border border-line-strong px-2.5 font-mono text-xs font-medium uppercase tracking-wider text-text-1 transition-colors hover:border-text-1 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-1 focus-visible:ring-offset-surface-0 disabled:pointer-events-none disabled:opacity-40"
      >
        Export {isOpen ? "▴" : "▾"}
      </button>

      {isOpen ? (
        <div
          id={menuId}
          className="absolute right-0 z-20 mt-1 flex w-56 flex-col border border-line bg-surface-1 py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              onClick={item.onSelect}
              className="px-3 py-2 text-left font-mono text-[11px] uppercase tracking-wider text-text-2 transition-colors hover:bg-surface-2 hover:text-text-1 focus-visible:bg-surface-2 focus-visible:text-text-1 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
