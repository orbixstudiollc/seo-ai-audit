"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createDocument } from "@/app/actions/documents";
import { importArticleFromUrl } from "@/app/actions/import";
import { formatAuditCostEstimate } from "@/lib/audit/cost";
import {
  getAuditProviderServerSnapshot,
  getAuditProviderSnapshot,
  isProvider,
  subscribeAuditProvider,
} from "@/lib/keys/preference";

interface NewAuditFormProps {
  /** Open the paste panel immediately (used for the empty state). */
  defaultOpen?: boolean;
}

type Mode = "paste" | "url";

const INPUT_CLASS =
  "border border-foreground/20 bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

function countWords(text: string): number {
  return text.trim().match(/\S+/g)?.length ?? 0;
}

export function NewAuditForm({ defaultOpen = false }: NewAuditFormProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [mode, setMode] = useState<Mode>("paste");
  const [title, setTitle] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // URL-import state. When an import succeeds the form is pre-filled and the
  // document is created with source "url", which makes createDocument parse
  // the content as HTML (isHtml) — same as the audit that follows.
  const [importUrl, setImportUrl] = useState("");
  const [importedUrl, setImportedUrl] = useState<string | null>(null);
  const [importedWordCount, setImportedWordCount] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Provider preference (localStorage, shared with settings) drives the
  // pre-run cost estimate. Null (unset / SSR) → show the honest range.
  const storedProvider = useSyncExternalStore(
    subscribeAuditProvider,
    getAuditProviderSnapshot,
    getAuditProviderServerSnapshot,
  );
  const provider = isProvider(storedProvider) ? storedProvider : null;

  // Imported HTML would overcount words through its markup, so prefer the
  // Readability word count for imported content; plain pastes count directly.
  const wordCount = importedUrl !== null && importedWordCount !== null
    ? importedWordCount
    : countWords(rawContent);
  const estimate = formatAuditCostEstimate(wordCount, provider);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setError(null);
    setIsSubmitting(true);
    try {
      const id = await createDocument({
        title: title.trim() || undefined,
        source: importedUrl !== null ? "url" : "paste",
        sourceUrl: importedUrl ?? undefined,
        rawContent,
      });
      router.push(`/app/doc/${id}`);
    } catch {
      setError("Could not create the audit. Check your content and try again.");
      setIsSubmitting(false);
    }
  }

  async function handleImport() {
    if (isImporting || importUrl.trim() === "") return;
    setImportError(null);
    setIsImporting(true);
    try {
      const result = await importArticleFromUrl(importUrl.trim());
      if (!result.ok) {
        setImportError(result.userMessage);
        return;
      }
      // Keep a user-typed title if the page had none worth extracting.
      if (result.title !== "") setTitle(result.title);
      setRawContent(result.contentHtml);
      setImportedUrl(result.finalUrl);
      setImportedWordCount(result.wordCount);
      // Show the pre-filled form so the user can review before running.
      setMode("paste");
    } catch {
      setImportError("Could not fetch this URL — paste the article text instead.");
    } finally {
      setIsImporting(false);
    }
  }

  function handleContentChange(value: string) {
    setRawContent(value);
    // Clearing the box severs the link to the imported URL — what the user
    // types next is a fresh paste, not edited import HTML.
    if (value.trim() === "" && importedUrl !== null) {
      setImportedUrl(null);
      setImportedWordCount(null);
    }
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="bg-foreground px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.15em] text-background transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
      >
        + New audit
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-foreground/15 bg-foreground/[0.02]"
      aria-label="New audit"
    >
      <div className="flex items-center justify-between border-b border-foreground/10 px-4 py-3">
        <div className="flex items-center gap-1" role="group" aria-label="Content source">
          {(["paste", "url"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`px-2 py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                mode === m
                  ? "bg-foreground/10 text-foreground"
                  : "text-foreground/50 hover:text-foreground"
              }`}
            >
              {m === "paste" ? "Paste" : "Import URL"}
            </button>
          ))}
        </div>
        {!defaultOpen && (
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="font-mono text-[11px] uppercase tracking-[0.15em] text-foreground/50 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
          >
            Cancel
          </button>
        )}
      </div>

      {mode === "url" ? (
        <div className="flex flex-col gap-4 p-4">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-foreground/50">
              Article URL
            </span>
            <input
              type="url"
              value={importUrl}
              onChange={(event) => setImportUrl(event.target.value)}
              onKeyDown={(event) => {
                // Enter fetches instead of submitting the (empty) audit form.
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleImport();
                }
              }}
              maxLength={2000}
              placeholder="https://example.com/blog/your-article"
              className={INPUT_CLASS}
            />
          </label>

          {importError ? (
            <p role="alert" className="text-sm text-red-600">
              {importError}{" "}
              <button
                type="button"
                onClick={() => setMode("paste")}
                className="font-medium text-foreground underline underline-offset-2 hover:text-accent focus-visible:text-accent focus-visible:outline-none"
              >
                Switch to paste
              </button>
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleImport}
              disabled={isImporting || importUrl.trim().length === 0}
              className="bg-foreground px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.15em] text-background transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isImporting ? "Fetching…" : "Fetch article"}
            </button>
            <p className="font-mono text-[11px] text-foreground/40">
              Import is best-effort — paste always works.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 p-4">
          {importedUrl !== null ? (
            <p className="border border-foreground/10 bg-foreground/[0.03] px-3 py-2 font-mono text-[11px] text-foreground/50">
              Imported from <span className="break-all text-foreground/70">{importedUrl}</span> —
              content is treated as HTML.
            </p>
          ) : null}

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-foreground/50">
              Title <span className="normal-case tracking-normal text-foreground/35">— optional, we&apos;ll use the first heading</span>
            </span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              placeholder="Untitled audit"
              className={INPUT_CLASS}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-foreground/50">
              Content <span className="text-accent">*</span>
            </span>
            <textarea
              required
              value={rawContent}
              onChange={(event) => handleContentChange(event.target.value)}
              rows={12}
              placeholder="Paste your article — markdown or plain text."
              className={`resize-y font-mono leading-relaxed ${INPUT_CLASS}`}
            />
          </label>

          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isSubmitting || rawContent.trim().length === 0}
              className="bg-foreground px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.15em] text-background transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Creating…" : "Run audit"}
            </button>
            <p className="font-mono text-[11px] text-foreground/40">
              {rawContent.trim().length > 0 ? (
                <>
                  <span className="text-foreground/60">{estimate}</span> · runs on your own OpenAI
                  or Anthropic key
                </>
              ) : (
                "Runs on your own OpenAI or Anthropic key."
              )}
            </p>
          </div>
        </div>
      )}
    </form>
  );
}
