"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocalSettings } from "@/app/hooks/useLocalSettings";
import { Button } from "./ui/Button";

type AuditMode = "single" | "site" | "agent";

const MAX_URL_LENGTH = 2048;

function validateUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Paste a URL to audit.";
  if (trimmed.length > MAX_URL_LENGTH) return "That URL is too long.";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Enter a full URL, including https://";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only http:// and https:// URLs are supported.";
  }
  return null;
}

const MODES: { value: AuditMode; label: string; help: string }[] = [
  { value: "single", label: "Single page", help: "Audit one URL." },
  { value: "site", label: "Whole site", help: "Discover and audit up to 500 pages." },
  { value: "agent", label: "Agent", help: "Plans every relevant check — you confirm the cost first." },
];

export function AuditUrlForm() {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const modeGroupId = useId();
  const [mode, setMode] = useState<AuditMode>("single");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { settings, ready } = useLocalSettings();

  useEffect(() => {
    if (ready) queueMicrotask(() => setMode(settings.defaultAuditMode));
  }, [ready, settings.defaultAuditMode]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateUrl(value);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    const encoded = encodeURIComponent(value.trim());
    const path = mode === "site" ? "/audit/site" : mode === "agent" ? "/audit/agent" : "/audit";
    router.push(`${path}?url=${encoded}`);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl" noValidate>
      <div role="radiogroup" aria-labelledby={modeGroupId} className="mb-3 inline-flex border border-line-strong bg-surface-1 p-1">
        <span id={modeGroupId} className="sr-only">
          Audit mode
        </span>
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="radio"
            aria-checked={mode === m.value}
            title={m.help}
            onClick={() => setMode(m.value)}
            className={`px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink ${
              mode === m.value ? "bg-text-1 text-surface-1" : "text-text-2 hover:text-text-1"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 border border-line-strong bg-surface-1 p-1.5 focus-within:border-accent-ink focus-within:ring-2 focus-within:ring-accent-ink/30 sm:flex-row sm:items-center">
        <span className="hidden select-none pl-3 font-mono text-sm text-text-3 sm:inline">$</span>
        <label htmlFor={inputId} className="sr-only">
          URL to audit
        </label>
        <input
          id={inputId}
          name="url"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={mode === "single" ? "https://example.com/your-article" : "https://example.com"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1 bg-transparent px-2 py-2.5 font-mono text-sm text-text-1 placeholder:text-text-3 focus:outline-none"
        />
        <Button type="submit" variant="primary" className="w-full sm:w-auto">
          {mode === "site" ? "Audit site" : mode === "agent" ? "Plan checks" : "Run audit"}
        </Button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-score-weak">
          {error}
        </p>
      )}
    </form>
  );
}
