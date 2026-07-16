"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import {
  CUSTOM_API_FORMATS,
  KEY_PROVIDERS,
  type ApiKeyProvider,
  type ApiKeyStatus,
  type CustomApiFormat,
  type KeyStatus,
} from "@/lib/keys/types";
import {
  getAuditProviderServerSnapshot,
  getAuditProviderSnapshot,
  isProvider,
  subscribeAuditProvider,
  writeAuditProvider,
} from "@/lib/keys/preference";

// Which provider runs audits lives in a shared localStorage preference
// (lib/keys/preference.ts) so the picker here and the workbench that reads it
// when starting an audit can never drift apart. Read via useSyncExternalStore:
// survives reloads, syncs across tabs, SSR-deterministic (server snapshot =
// null), no setState-in-effect. `preferred` is derived from it, never mirrored.

// The two named providers have fixed console/pricing copy. "custom" doesn't —
// its display name, endpoint, and cost are whatever the user configures — so
// it's handled by CustomProviderRow below instead of living in this map.
const NAMED_PROVIDERS = KEY_PROVIDERS.filter(
  (provider): provider is "openai" | "anthropic" => provider !== "custom",
);

const PROVIDER_META: Record<
  "openai" | "anthropic",
  { label: string; console: string; consoleUrl: string; keyExample: string; costPer1500: string }
> = {
  openai: {
    label: "OpenAI",
    console: "platform.openai.com",
    consoleUrl: "https://platform.openai.com/api-keys",
    keyExample: "sk-…",
    costPer1500: "~$0.05",
  },
  anthropic: {
    label: "Anthropic",
    console: "console.anthropic.com",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    keyExample: "sk-ant-…",
    costPer1500: "~$0.08",
  },
};

const API_FORMAT_LABEL: Record<CustomApiFormat, string> = {
  openai: "OpenAI-compatible",
  anthropic: "Anthropic-compatible",
};

// Semantic red/amber/green for status, each paired with a distinct GLYPH and a
// text LABEL so the state never depends on color alone (colorblind-safe cue).
const STATUS_META: Record<ApiKeyStatus, { label: string; symbol: string; className: string }> = {
  valid: { label: "Valid", symbol: "●", className: "text-score-strong" },
  quota: { label: "Out of quota", symbol: "▲", className: "text-score-mid" },
  invalid: { label: "Invalid", symbol: "✕", className: "text-score-weak" },
};

type KeyMap = Record<ApiKeyProvider, KeyStatus | null>;

function toKeyMap(keys: KeyStatus[]): KeyMap {
  const map: KeyMap = { openai: null, anthropic: null, custom: null };
  for (const key of keys) map[key.provider] = key;
  return map;
}

function defaultPreferred(keys: KeyMap): ApiKeyProvider | null {
  const withValid = KEY_PROVIDERS.find((provider) => keys[provider]?.status === "valid");
  if (withValid) return withValid;
  return KEY_PROVIDERS.find((provider) => keys[provider] !== null) ?? null;
}

// Locale-independent, deterministic format (no toLocaleString → no SSR/client
// hydration mismatch). e.g. "2026-07-11 09:41 UTC".
function formatValidatedAt(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

type CustomKeyFields = {
  customName: string;
  baseUrl: string;
  apiFormat: CustomApiFormat;
  cheapModel: string;
  strongModel: string;
};

async function saveKey(
  provider: ApiKeyProvider,
  apiKey: string,
  custom?: CustomKeyFields,
): Promise<KeyStatus> {
  const res = await fetch("/api/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, apiKey, ...custom }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "Could not save key.");
  }
  return (await res.json()) as KeyStatus;
}

function StatusBadge({ status }: { status: ApiKeyStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide ${meta.className}`}
      aria-label={`Key status: ${meta.label}`}
    >
      <span aria-hidden="true">{meta.symbol}</span>
      {meta.label}
    </span>
  );
}

type ProviderRowProps = {
  provider: "openai" | "anthropic";
  current: KeyStatus | null;
  onSaved: (key: KeyStatus) => void;
  onRemoved: (provider: ApiKeyProvider) => void;
};

function ProviderRow({ provider, current, onSaved, onRemoved }: ProviderRowProps) {
  const meta = PROVIDER_META[provider];
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputId = `apikey-${provider}`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending("save");
    try {
      const saved = await saveKey(provider, apiKey.trim());
      setApiKey("");
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save key.");
    } finally {
      setPending(null);
    }
  }

  async function handleRemove() {
    setError(null);
    setPending("remove");
    try {
      const res = await fetch(`/api/keys?provider=${provider}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not remove key.");
      onRemoved(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove key.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      className="border border-line bg-surface-1 p-5"
      aria-labelledby={`${provider}-heading`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${provider}-heading`} className="text-lg font-semibold">
          {meta.label}
        </h2>
        <a
          href={meta.consoleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-accent-ink underline underline-offset-2"
        >
          {meta.console} &#8599;
        </a>
      </div>

      {current ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-line py-3">
          <code className="font-mono text-sm text-text-1">{current.keyHint}</code>
          <StatusBadge status={current.status} />
          {current.lastValidatedAt ? (
            <span className="font-mono text-[11px] text-text-3">
              validated {formatValidatedAt(current.lastValidatedAt)}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 border-y border-line py-3 text-sm text-text-3">
          No key set &mdash; audits on {meta.label} are disabled until you add one.
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label htmlFor={inputId} className="flex flex-1 flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-widest text-text-3">
            {current ? "Replace key" : "Add key"}
          </span>
          <input
            id={inputId}
            name={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={meta.keyExample}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            className="w-full border border-line-strong bg-surface-1 px-3 py-2 font-mono text-sm text-text-1 placeholder:text-text-3/60 focus:border-accent-ink focus:outline-none focus:ring-1 focus:ring-accent-ink"
          />
        </label>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending !== null || apiKey.trim().length === 0}
            className="shrink-0 bg-text-1 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-surface-1 transition-colors hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending === "save" ? "Validating…" : current ? "Replace" : "Save"}
          </button>
          {current ? (
            <button
              type="button"
              onClick={handleRemove}
              disabled={pending !== null}
              className="shrink-0 border border-line-strong px-4 py-2 text-sm font-semibold uppercase tracking-wide text-text-2 transition-colors hover:border-score-weak hover:text-score-weak disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending === "remove" ? "Removing…" : "Remove"}
            </button>
          ) : null}
        </div>
      </form>

      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm">
        {error ? <span className="text-score-weak">{error}</span> : null}
      </p>
    </section>
  );
}

const FIELD_CLASS =
  "w-full border border-line-strong bg-surface-1 px-3 py-2 font-mono text-sm text-text-1 placeholder:text-text-3/60 focus:border-accent-ink focus:outline-none focus:ring-1 focus:ring-accent-ink";

type CustomProviderRowProps = {
  current: KeyStatus | null;
  onSaved: (key: KeyStatus) => void;
  onRemoved: () => void;
};

/**
 * The "custom" provider slot: point audits at any OpenAI- or
 * Anthropic-compatible endpoint (a proxy, reseller, or self-hosted gateway)
 * with your own model ids. A separate component from ProviderRow, not a
 * conditional branch inside it — the form shape is genuinely different (five
 * fields instead of one), and forcing them into one component would make
 * both harder to read.
 */
function CustomProviderRow({ current, onSaved, onRemoved }: CustomProviderRowProps) {
  const [customName, setCustomName] = useState(current?.customName ?? "");
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? "");
  const [apiFormat, setApiFormat] = useState<CustomApiFormat>(current?.apiFormat ?? "openai");
  const [cheapModel, setCheapModel] = useState(current?.cheapModel ?? "");
  const [strongModel, setStrongModel] = useState(current?.strongModel ?? "");
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    customName.trim().length > 0 &&
    baseUrl.trim().length > 0 &&
    cheapModel.trim().length > 0 &&
    strongModel.trim().length > 0 &&
    apiKey.trim().length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setPending("save");
    try {
      const saved = await saveKey("custom", apiKey.trim(), {
        customName: customName.trim(),
        baseUrl: baseUrl.trim(),
        apiFormat,
        cheapModel: cheapModel.trim(),
        strongModel: strongModel.trim(),
      });
      setApiKey("");
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save custom provider.");
    } finally {
      setPending(null);
    }
  }

  async function handleRemove() {
    setError(null);
    setPending("remove");
    try {
      const res = await fetch("/api/keys?provider=custom", { method: "DELETE" });
      if (!res.ok) throw new Error("Could not remove custom provider.");
      onRemoved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove custom provider.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="border border-line bg-surface-1 p-5" aria-labelledby="custom-heading">
      <h2 id="custom-heading" className="text-lg font-semibold">
        Custom provider
      </h2>
      <p className="mt-1 text-sm text-text-3">
        Any OpenAI- or Anthropic-compatible endpoint — a proxy, reseller, or
        self-hosted gateway. Cost depends entirely on what that endpoint
        charges; there&rsquo;s no fixed anchor to quote.
      </p>

      {current ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-line py-3">
          <span className="text-sm font-semibold text-text-1">{current.customName}</span>
          <code className="font-mono text-xs text-text-3">{current.baseUrl}</code>
          <code className="font-mono text-sm text-text-1">{current.keyHint}</code>
          <StatusBadge status={current.status} />
        </div>
      ) : (
        <p className="mt-4 border-y border-line py-3 text-sm text-text-3">
          No custom provider set &mdash; audits can&apos;t use one until you add it.
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-widest text-text-3">
              Provider name
            </span>
            <input
              type="text"
              placeholder="e.g. Claude Store"
              value={customName}
              onChange={(event) => setCustomName(event.target.value)}
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-widest text-text-3">
              API format
            </span>
            <select
              value={apiFormat}
              onChange={(event) => setApiFormat(event.target.value as CustomApiFormat)}
              className={FIELD_CLASS}
            >
              {CUSTOM_API_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {API_FORMAT_LABEL[format]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-widest text-text-3">
            API endpoint
          </span>
          <input
            type="url"
            placeholder="https://api.example.com"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            className={FIELD_CLASS}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-widest text-text-3">
              Cheap-tier model id
            </span>
            <input
              type="text"
              placeholder="e.g. claude-haiku-4-5"
              value={cheapModel}
              onChange={(event) => setCheapModel(event.target.value)}
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-widest text-text-3">
              Strong-tier model id
            </span>
            <input
              type="text"
              placeholder="e.g. claude-sonnet-5"
              value={strongModel}
              onChange={(event) => setStrongModel(event.target.value)}
              className={FIELD_CLASS}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[11px] uppercase tracking-widest text-text-3">
            {current ? "Replace key" : "API key"}
          </span>
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="your provider's key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            className={FIELD_CLASS}
          />
        </label>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending !== null || !canSubmit}
            className="shrink-0 bg-text-1 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-surface-1 transition-colors hover:bg-accent-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending === "save" ? "Validating…" : current ? "Replace" : "Save"}
          </button>
          {current ? (
            <button
              type="button"
              onClick={handleRemove}
              disabled={pending !== null}
              className="shrink-0 border border-line-strong px-4 py-2 text-sm font-semibold uppercase tracking-wide text-text-2 transition-colors hover:border-score-weak hover:text-score-weak disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending === "remove" ? "Removing…" : "Remove"}
            </button>
          ) : null}
        </div>
      </form>

      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm">
        {error ? <span className="text-score-weak">{error}</span> : null}
      </p>
    </section>
  );
}

export function KeySettingsForm({ initialKeys }: { initialKeys: KeyStatus[] }) {
  const [keys, setKeys] = useState<KeyMap>(() => toKeyMap(initialKeys));

  const storedPreference = useSyncExternalStore(
    subscribeAuditProvider,
    getAuditProviderSnapshot,
    getAuditProviderServerSnapshot,
  );

  // A stored preference only counts while that provider still has a key;
  // otherwise (or on the server) fall back to a deterministic default. This
  // guard also means a stale value pointing at a removed key self-heals — no
  // cleanup write needed on remove.
  const storedProvider: ApiKeyProvider | null =
    isProvider(storedPreference) && keys[storedPreference] !== null ? storedPreference : null;
  const preferred = storedProvider ?? defaultPreferred(keys);

  function handleSaved(saved: KeyStatus) {
    setKeys((prev) => ({ ...prev, [saved.provider]: saved }));
  }

  function handleRemoved(removed: ApiKeyProvider) {
    setKeys((prev) => ({ ...prev, [removed]: null }));
  }

  // Custom has no fixed display name or cost anchor — both come from the
  // row itself once configured (see PROVIDER_META's comment for why it isn't
  // in that static map).
  function providerLabel(provider: ApiKeyProvider): string {
    if (provider === "custom") return keys.custom?.customName ?? "Custom provider";
    return PROVIDER_META[provider].label;
  }

  const hasAnyKey = KEY_PROVIDERS.some((provider) => keys[provider] !== null);
  const costLine =
    preferred === "custom"
      ? `Cost depends on ${providerLabel("custom")}'s pricing — check with that provider.`
      : preferred
        ? `${PROVIDER_META[preferred].costPer1500} per 1,500-word audit on your own ${PROVIDER_META[preferred].label} key.`
        : "Audits cost pennies on your own key — roughly $0.05–$0.08 per 1,500-word article.";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-6">
        {NAMED_PROVIDERS.map((provider) => (
          <ProviderRow
            key={provider}
            provider={provider}
            current={keys[provider]}
            onSaved={handleSaved}
            onRemoved={handleRemoved}
          />
        ))}
        <CustomProviderRow
          current={keys.custom}
          onSaved={handleSaved}
          onRemoved={() => handleRemoved("custom")}
        />
      </div>

      <fieldset className="border border-line bg-surface-2 p-5">
        <legend className="px-1 font-mono text-[11px] uppercase tracking-widest text-text-3">
          Audit provider
        </legend>

        {hasAnyKey ? (
          <div
            role="radiogroup"
            aria-label="Provider used to run audits"
            className="flex flex-wrap gap-2"
          >
            {KEY_PROVIDERS.map((provider) => {
              const disabled = keys[provider] === null;
              const selected = preferred === provider;
              return (
                <label
                  key={provider}
                  className={`flex items-center gap-2 border px-4 py-2 text-sm transition-colors ${
                    selected
                      ? "border-accent-line bg-accent-tint text-text-1"
                      : "border-line-strong text-text-2 hover:border-text-3"
                  } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
                >
                  <input
                    type="radio"
                    name="audit-provider"
                    value={provider}
                    checked={selected}
                    disabled={disabled}
                    onChange={() => writeAuditProvider(provider)}
                    className="sr-only"
                  />
                  <span aria-hidden="true" className="font-mono text-xs">
                    {selected ? "●" : "○"}
                  </span>
                  {providerLabel(provider)}
                </label>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-text-3">
            Add a key above to pick which provider runs your audits.
          </p>
        )}

        <p className="mt-4 font-mono text-xs text-text-3">{costLine}</p>
      </fieldset>
    </div>
  );
}
