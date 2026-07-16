import { db, ensureE2eDb } from "@/db/client";
import { apiKeys, user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { encryptApiKey, keyHint } from "@/lib/crypto/apiKeys";
import { eq } from "drizzle-orm";

/**
 * Non-secret half of the operator-configured demo custom provider. The key
 * itself is never written here — see the DEMO_CUSTOM_PROVIDER_KEY read below.
 */
const DEMO_CUSTOM_PROVIDER = {
  customName: "Claude Store",
  baseUrl: "https://api3.claudestore.store",
  apiFormat: "anthropic" as const,
  cheapModel: "claude-haiku-4.5",
  strongModel: "claude-sonnet-5",
};

/**
 * Signs up a fresh throwaway user through the real Better Auth path and
 * stores a BYOK key so the audit route's key lookup succeeds. Shared by the
 * Playwright seed route and the browser-facing demo-login route so both
 * stay in sync.
 *
 * When DEMO_CUSTOM_PROVIDER_KEY is set in the server environment, every
 * seeded demo user gets that real custom-provider key pre-configured (so
 * audits actually run end-to-end without visiting Settings first). The
 * secret lives only in that env var — never in source — so it's safe for
 * this file to be public even when the var is set on someone's own server.
 * Otherwise, falls back to a fake (but really encrypted) OpenAI key that
 * satisfies the key lookup for AUDIT_TEST_MOCK-mode testing, where the
 * key's value is never actually used.
 *
 * Callers must gate on `process.env.E2E_PGLITE === "1"` themselves before
 * calling this — it never checks that itself, since it always throws
 * (via ensureE2eDb) if the PGlite database was never initialized.
 */
export async function seedDemoUser(): Promise<{ email: string; cookies: string[] }> {
  await ensureE2eDb();

  const email = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = "demo-password-123456";

  const signup = await auth.api.signUpEmail({
    body: { email, password, name: "Demo User" },
    asResponse: true,
  });
  const cookies = signup.headers.getSetCookie();
  if (signup.status !== 200 || cookies.length === 0) {
    throw new Error(`demo signup failed: ${signup.status}`);
  }

  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (!row) {
    throw new Error("demo user not found after signup");
  }

  const customKey = process.env.DEMO_CUSTOM_PROVIDER_KEY;
  if (customKey) {
    await db.insert(apiKeys).values({
      userId: row.id,
      provider: "custom",
      ciphertext: encryptApiKey(customKey, row.id),
      keyHint: keyHint(customKey),
      status: "valid",
      ...DEMO_CUSTOM_PROVIDER,
    });
  } else {
    const fakeKey = "sk-demo-fake-openai-key-000000000000";
    await db.insert(apiKeys).values({
      userId: row.id,
      provider: "openai",
      ciphertext: encryptApiKey(fakeKey, row.id),
      keyHint: keyHint(fakeKey),
      status: "valid",
    });
  }

  return { email, cookies };
}
