// Shared BYOK key contract. Kept in a plain module (no server/db imports) so
// it's safe to import from the route handler, the server action, AND the
// client settings form without dragging drizzle or node:crypto into the
// client bundle. Mirrors the api_keys enum columns in db/schema.ts.

export const KEY_PROVIDERS = ["openai", "anthropic", "custom"] as const;
export type ApiKeyProvider = (typeof KEY_PROVIDERS)[number];

export const CUSTOM_API_FORMATS = ["openai", "anthropic"] as const;
export type CustomApiFormat = (typeof CUSTOM_API_FORMATS)[number];

export const KEY_STATUSES = ["valid", "invalid", "quota"] as const;
export type ApiKeyStatus = (typeof KEY_STATUSES)[number];

/**
 * The ONLY shape any keys endpoint may return for a stored key. Never contains
 * ciphertext or plaintext — just the display hint and validation state. The
 * custom* fields are non-secret config (not the key itself) so they're safe
 * to return for display/editing; they're only ever set when provider="custom".
 */
export type KeyStatus = {
  provider: ApiKeyProvider;
  keyHint: string;
  status: ApiKeyStatus;
  /** ISO-8601 UTC string, or null if the key was never validated. */
  lastValidatedAt: string | null;
  customName: string | null;
  baseUrl: string | null;
  apiFormat: CustomApiFormat | null;
  cheapModel: string | null;
  strongModel: string | null;
};
