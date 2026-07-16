"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/Button";

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

export function AuditUrlForm() {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateUrl(value);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    router.push(`/audit?url=${encodeURIComponent(value.trim())}`);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl" noValidate>
      <div className="flex flex-col gap-2 border border-line-strong bg-surface-1 p-1.5 sm:flex-row sm:items-center">
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
          placeholder="https://example.com/your-article"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1 bg-transparent px-2 py-2.5 font-mono text-sm text-text-1 placeholder:text-text-3 focus:outline-none"
        />
        <Button type="submit" variant="primary" className="w-full sm:w-auto">
          Run audit
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
