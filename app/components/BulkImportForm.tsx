"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { bulkImportArticles, type BulkImportResult } from "@/app/actions/bulkImport";
import { MAX_ARTICLE_LIST_ROWS } from "@/lib/csv/constants";

// Generous for MAX_ARTICLE_LIST_ROWS rows of "url,title" text; the server
// enforces the real (character-based) cap, this just fails fast in the
// browser before uploading an obviously-wrong file.
const MAX_FILE_BYTES = 100_000;

export function BulkImportForm() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setPickError(null);
    setResult(null);

    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      setPickError("That doesn't look like a .csv file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setPickError(`File is too large (max ${Math.round(MAX_FILE_BYTES / 1000)}KB).`);
      return;
    }

    setIsSubmitting(true);
    try {
      const text = await file.text();
      const outcome = await bulkImportArticles(text);
      setResult(outcome);
      if (outcome.created.length > 0) router.refresh();
    } catch {
      setPickError("Bulk import failed unexpectedly. Try again.");
    } finally {
      setIsSubmitting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="border border-foreground/20 px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.15em] text-foreground/70 transition-colors hover:border-foreground hover:text-foreground focus-visible:border-foreground focus-visible:text-foreground focus-visible:outline-none"
      >
        Bulk upload CSV
      </button>
    );
  }

  return (
    <div className="border border-foreground/15 bg-foreground/[0.02]" aria-label="Bulk upload CSV">
      <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-foreground">
          Bulk upload CSV
        </span>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="font-mono text-[11px] uppercase tracking-[0.15em] text-foreground/50 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
        >
          Cancel
        </button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <p className="font-mono text-[11px] text-foreground/50">
          A CSV with a <code>url</code> column (one article URL per row) and an optional{" "}
          <code>title</code> column. Each row is imported the same way as a single URL import —
          paste always works as a fallback for anything that fails. Max {MAX_ARTICLE_LIST_ROWS} rows
          per upload.
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-foreground/50">
            CSV file
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            disabled={isSubmitting}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
            className="text-sm text-foreground file:mr-3 file:border file:border-foreground/20 file:bg-transparent file:px-3 file:py-1.5 file:font-mono file:text-xs file:uppercase file:tracking-wide file:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>

        {isSubmitting ? (
          <p className="font-mono text-[11px] text-foreground/50">Importing…</p>
        ) : null}

        {pickError ? (
          <p role="alert" className="text-sm text-red-600">
            {pickError}
          </p>
        ) : null}

        {result ? (
          <div role="status" aria-live="polite" className="flex flex-col gap-2 text-sm">
            {result.fatalError ? (
              <p className="text-red-600">{result.fatalError}</p>
            ) : (
              <>
                <p className="text-foreground">
                  {result.created.length} imported
                  {result.failed.length > 0 ? `, ${result.failed.length} failed` : ""}.
                </p>
                {result.failed.length > 0 ? (
                  <ul className="flex flex-col gap-1 font-mono text-[11px] text-foreground/60">
                    {result.failed.map((item) => (
                      <li key={item.url}>
                        {item.url} — {item.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
            {result.warnings.length > 0 ? (
              <ul className="flex flex-col gap-1 font-mono text-[11px] text-foreground/40">
                {result.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
