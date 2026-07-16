import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for BYOK (bring-your-own-key) provider API keys.
 *
 * Stored ciphertext layout (base64-encoded): keyVersion(1B) ‖ iv(12B) ‖ authTag(16B) ‖ ciphertext.
 * The leading version byte lets a future ENCRYPTION_KEY rotation register a
 * previous key alongside the current one (see `getKeyForVersion`) so old
 * rows keep decrypting without a big-bang re-encryption migration.
 *
 * ENCRYPTION_KEY encoding: base64 (not hex) — chosen because it's the
 * standard output of `openssl rand -base64 32` and keeps the env var value
 * shorter than the equivalent 64-character hex string. Generate one with:
 *   openssl rand -base64 32
 */

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12; // 96-bit IV — NIST SP 800-38D recommended length for GCM.
const AUTH_TAG_LENGTH_BYTES = 16;
const VERSION_LENGTH_BYTES = 1;
const MIN_BLOB_LENGTH_BYTES = VERSION_LENGTH_BYTES + IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES;

/** key_version tag written into every new ciphertext. Bump on ENCRYPTION_KEY rotation. */
const CURRENT_KEY_VERSION = 1;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeKey(raw: string | undefined, envVarName: string): Buffer {
  if (!raw) {
    throw new Error(
      `${envVarName} is not set. BYOK key storage requires a base64-encoded 32-byte encryption key ` +
        `(generate one with: openssl rand -base64 32).`,
    );
  }
  if (!BASE64_PATTERN.test(raw)) {
    throw new Error(`${envVarName} is not valid base64.`);
  }
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `${envVarName} must decode to exactly ${KEY_LENGTH_BYTES} bytes, got ${decoded.length}. ` +
        `Generate a valid key with: openssl rand -base64 32`,
    );
  }
  return decoded;
}

let cachedCurrentKey: Buffer | undefined;

function loadCurrentKey(): Buffer {
  if (!cachedCurrentKey) {
    cachedCurrentKey = decodeKey(process.env.ENCRYPTION_KEY, "ENCRYPTION_KEY");
  }
  return cachedCurrentKey;
}

/**
 * Validates that ENCRYPTION_KEY is present, valid base64, and decodes to
 * exactly 32 bytes. Throws a descriptive error otherwise.
 *
 * NOT called at module top level: importing this module must be side-effect
 * free so `next build` can collect page data without ENCRYPTION_KEY present
 * (mirrors the lazy db client — safe at build time, throws only on real use).
 * The first encryptApiKey/decryptApiKey call runs loadCurrentKey() and fails
 * fast there if the key is missing or malformed. A deploy that wants an
 * explicit boot-time check can call this from instrumentation.
 */
export function assertEncryptionKeyConfigured(): void {
  loadCurrentKey();
}

/**
 * Looks up the AES key for a stored ciphertext's key_version byte.
 *
 * ponytail: only version 1 (ENCRYPTION_KEY) exists today. When
 * ENCRYPTION_KEY next rotates, decode the previous key (e.g. from an
 * ENCRYPTION_KEY_PREVIOUS env var, same decodeKey() validation) and add it
 * here under its version number, so ciphertext written under the old key
 * keeps decrypting during rollover — encryptApiKey always writes under
 * CURRENT_KEY_VERSION, so new rows immediately use the new key.
 */
function getKeyForVersion(version: number): Buffer {
  if (version === CURRENT_KEY_VERSION) {
    return loadCurrentKey();
  }
  throw new Error(`Unrecognized BYOK ciphertext key_version ${version}.`);
}

function requireNonEmptyString(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

/**
 * Encrypts a BYOK provider API key for storage in api_keys.ciphertext.
 *
 * AAD is the owning user's id, so the ciphertext is cryptographically bound
 * to that row: decrypting with any other userId throws instead of silently
 * returning a different user's key.
 */
export function encryptApiKey(plaintext: string, userId: string): string {
  requireNonEmptyString(plaintext, "plaintext");
  requireNonEmptyString(userId, "userId");

  const key = loadCurrentKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });
  cipher.setAAD(Buffer.from(userId, "utf8"));

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const versionByte = Buffer.from([CURRENT_KEY_VERSION]);

  return Buffer.concat([versionByte, iv, authTag, ciphertext]).toString("base64");
}

/**
 * Decrypts a ciphertext blob produced by encryptApiKey.
 *
 * Throws if userId doesn't match the id used to encrypt, if the blob was
 * tampered with or truncated, or if its key_version has no registered key.
 * GCM auth-tag verification (Node's createDecipheriv/final) detects tamper
 * and AAD mismatch automatically — that error is never caught or swallowed
 * here, it propagates straight to the caller.
 *
 * SECURITY: the returned plaintext is the user's raw provider API key.
 * Callers MUST keep it in a request-scoped local variable only — never
 * cache, memoize, or hoist it into module-level or global state.
 */
export function decryptApiKey(blob: string, userId: string): string {
  requireNonEmptyString(blob, "blob");
  requireNonEmptyString(userId, "userId");

  const blobBytes = Buffer.from(blob, "base64");
  if (blobBytes.length < MIN_BLOB_LENGTH_BYTES) {
    throw new Error("Malformed BYOK ciphertext: blob is shorter than the key_version+iv+authTag header.");
  }

  const version = blobBytes.readUInt8(0);
  const iv = blobBytes.subarray(VERSION_LENGTH_BYTES, VERSION_LENGTH_BYTES + IV_LENGTH_BYTES);
  const authTag = blobBytes.subarray(VERSION_LENGTH_BYTES + IV_LENGTH_BYTES, MIN_BLOB_LENGTH_BYTES);
  const ciphertext = blobBytes.subarray(MIN_BLOB_LENGTH_BYTES);

  const key = getKeyForVersion(version);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });
  decipher.setAAD(Buffer.from(userId, "utf8"));
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

// Longest/most-specific prefix first, so Anthropic keys aren't misdetected as OpenAI's "sk-".
const PROVIDER_PREFIXES = ["sk-ant-", "sk-"] as const;

/**
 * Display hint for a BYOK key: preserves the provider prefix and the last 4
 * characters only, e.g. "sk-...abc4" (OpenAI-style) or "sk-ant-...wxyz"
 * (Anthropic-style). Never reveals more of the key than that.
 */
export function keyHint(plaintext: string): string {
  requireNonEmptyString(plaintext, "plaintext");

  const prefix = PROVIDER_PREFIXES.find((candidate) => plaintext.startsWith(candidate)) ?? "";
  const last4 = plaintext.slice(-4);
  return `${prefix}...${last4}`;
}
