import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

const H = vi.hoisted(() => ({ session: null as { user: { id: string } } | null }));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => H.session } },
}));

vi.mock("@/db/client", async () => {
  const { dbProxy } = await import("../helpers/testDb");
  return { db: dbProxy };
});

import { DELETE, POST } from "@/app/api/keys/route";
import { apiKeys } from "@/db/schema";
import { decryptApiKey } from "@/lib/crypto/apiKeys";
import { closeTestDb, dbProxy, initTestDb, resetTestDb, seedUser } from "../helpers/testDb";

const OPENAI_KEY = "sk-openai-valid-key-abcdef012345";

/**
 * Stub global fetch to answer the provider validation call with a chosen
 * status/code. Includes `message`/`type` alongside `code` (a realistic
 * provider error envelope, not just the bare code) because the custom-
 * provider path validates through the AI SDK, whose provider error parsers
 * only populate `APICallError.data` from a body matching their full error
 * schema — the raw-fetch openai/anthropic validators don't care (they read
 * `.error.code` directly off `res.json()`), but this shared stub now serves
 * both.
 */
function stubProviderFetch(status: number, code?: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify(code ? { error: { code, type: code, message: `stub: ${code}` } } : {}),
        { status, headers: { "content-type": "application/json" } },
      ),
    ),
  );
}

let ipSeq = 0;
function postKeyRequest(body: unknown, ip?: string): Request {
  return new Request("http://localhost/api/keys", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Distinct IP per request by default keeps the per-IP bucket from
      // bleeding across tests; the rate-limit test pins one user instead.
      "x-forwarded-for": ip ?? `10.1.0.${++ipSeq}`,
    },
    body: JSON.stringify(body),
  });
}

function deleteKeyRequest(provider: string): Request {
  return new Request(`http://localhost/api/keys?provider=${provider}`, { method: "DELETE" });
}

async function keyRows(userId: string) {
  return dbProxy.select().from(apiKeys).where(eq(apiKeys.userId, userId));
}

beforeAll(async () => {
  await initTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  H.session = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/keys — validate + encrypt + store", () => {
  it("round-trips a valid key: encrypted at rest, decrypts back to the plaintext", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    stubProviderFetch(200);

    const res = await POST(postKeyRequest({ provider: "openai", apiKey: OPENAI_KEY }));
    expect(res.status).toBe(200);

    const rows = await keyRows(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("valid");
    // Stored ciphertext is NOT the plaintext, and decrypts back to it with the AAD.
    expect(rows[0].ciphertext).not.toContain(OPENAI_KEY);
    expect(decryptApiKey(rows[0].ciphertext, userId)).toBe(OPENAI_KEY);
  });

  it("never returns ciphertext or plaintext in the response", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    stubProviderFetch(200);

    const res = await POST(postKeyRequest({ provider: "openai", apiKey: OPENAI_KEY }));
    const body = (await res.json()) as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    // Only the display-safe hint (+ the always-present, always-null custom-*
    // columns — non-secret config, null for a non-custom provider) is exposed.
    expect(Object.keys(body).sort()).toEqual([
      "apiFormat",
      "baseUrl",
      "cheapModel",
      "customName",
      "keyHint",
      "lastValidatedAt",
      "provider",
      "status",
      "strongModel",
    ]);
    expect(serialized).not.toContain(OPENAI_KEY);
    const [row] = await keyRows(userId);
    expect(serialized).not.toContain(row.ciphertext);
    expect(body.keyHint).toBe("sk-...2345");
  });

  it("stores a real-but-out-of-credit key with status 'quota'", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    // 429 + insufficient_quota == the key authenticates, it just has no credit.
    stubProviderFetch(429, "insufficient_quota");

    const res = await POST(postKeyRequest({ provider: "openai", apiKey: OPENAI_KEY }));
    expect(res.status).toBe(200);
    const [row] = await keyRows(userId);
    expect(row.status).toBe("quota");
  });

  it("rejects a provider-rejected (wrong) key and stores nothing", async () => {
    // A key the provider 401s on — e.g. the wrong provider's key, or a revoked one.
    // The route surfaces kind 'invalid' and deliberately does NOT persist a dead
    // credential (keeps /api/keys from being an oracle for probing stolen keys).
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    stubProviderFetch(401, "invalid_api_key");

    const res = await POST(postKeyRequest({ provider: "anthropic", apiKey: OPENAI_KEY }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("invalid");
    expect(await keyRows(userId)).toHaveLength(0);
  });

  it("rejects an unauthenticated request", async () => {
    H.session = null;
    stubProviderFetch(200);
    const res = await POST(postKeyRequest({ provider: "openai", apiKey: OPENAI_KEY }));
    expect(res.status).toBe(401);
  });

  it("rejects a malformed key without contacting the provider", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(postKeyRequest({ provider: "openai", apiKey: "not-an-sk-key" }));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

const CUSTOM_FIELDS = {
  customName: "Claude Store",
  baseUrl: "https://api3.claudestore.store",
  apiFormat: "anthropic" as const,
  cheapModel: "claude-haiku-4-5",
  strongModel: "claude-sonnet-5",
};

describe("POST /api/keys — custom provider", () => {
  it("rejects a request missing required custom-provider fields, before contacting anything", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    // No baseUrl/apiFormat/model ids — only what the two named providers need.
    const res = await POST(postKeyRequest({ provider: "custom", apiKey: "sk-anything" }));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await keyRows(userId)).toHaveLength(0);
  });

  it("rejects a bad custom endpoint URL (non-http scheme) at the schema, before contacting anything", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(
      postKeyRequest({
        provider: "custom",
        apiKey: "sk-anything",
        ...CUSTOM_FIELDS,
        baseUrl: "javascript:alert(1)",
      }),
    );
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await keyRows(userId)).toHaveLength(0);
  });

  it("rejects a custom endpoint that 401s and stores nothing", async () => {
    // validateCustom drives a real generateText call through the AI SDK, which
    // throws APICallError (with the response's status/body) on a non-2xx —
    // the exact same mechanism classifyProviderResponse already branches on
    // for the two named providers, so the existing 401 stub applies as-is.
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    stubProviderFetch(401, "invalid_api_key");

    const res = await POST(
      postKeyRequest({ provider: "custom", apiKey: "sk-wrong", ...CUSTOM_FIELDS }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("invalid");
    expect(await keyRows(userId)).toHaveLength(0);
  });

  it("stores the custom provider's non-secret config alongside the encrypted key", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    // insufficient_quota still classifies as a real-and-authenticating key
    // ("quota", not "invalid") without needing a fully AI-SDK-shaped 2xx body.
    // apiFormat "openai" here (not CUSTOM_FIELDS' default "anthropic"): the AI
    // SDK's provider error parsers only populate APICallError.data from a body
    // matching that PROVIDER's own error schema, and stubProviderFetch's
    // {error:{code,type,message}} shape is OpenAI's, not Anthropic's — proven
    // separately by the 401 test above, which passes for either format because
    // classifyProviderResponse's 401/403 branch needs only the status code.
    stubProviderFetch(429, "insufficient_quota");

    const res = await POST(
      postKeyRequest({
        provider: "custom",
        apiKey: "sk-real-but-broke",
        ...CUSTOM_FIELDS,
        apiFormat: "openai",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      provider: "custom",
      status: "quota",
      ...CUSTOM_FIELDS,
      apiFormat: "openai",
    });
    expect(JSON.stringify(body)).not.toContain("sk-real-but-broke");

    const [row] = await keyRows(userId);
    expect(row.baseUrl).toBe(CUSTOM_FIELDS.baseUrl);
    expect(decryptApiKey(row.ciphertext, userId)).toBe("sk-real-but-broke");
  });
});

describe("POST /api/keys — rate limit", () => {
  it("rejects the 6th call in the per-user window with 429 + Retry-After", async () => {
    // Arrange — one user; distinct IPs so only the per-user bucket is exercised.
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    stubProviderFetch(200);

    // Act — KEYS_USER_LIMIT is 5; the 6th call in the window must be rejected.
    const statuses: number[] = [];
    let limited: Response | null = null;
    for (let i = 0; i < 6; i++) {
      const res = await POST(postKeyRequest({ provider: "openai", apiKey: OPENAI_KEY }));
      statuses.push(res.status);
      if (res.status === 429) limited = res;
      await res.json().catch(() => null);
    }

    // Assert — first 5 pass, the 6th is rate-limited and advertises Retry-After.
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
    expect(limited?.headers.get("Retry-After")).toBeTruthy();
  });

  it("rejects the 16th call from one IP across distinct users (per-IP bucket)", async () => {
    // Arrange — every call pins the SAME x-forwarded-for IP, rotating users so
    // the per-user bucket (limit 5) never trips and only the per-IP bucket
    // (KEYS_IP_LIMIT = 15) is exercised. IP unique to this test: the in-memory
    // buckets persist across tests in the file.
    stubProviderFetch(200);
    const SHARED_IP = "10.2.77.7";

    // Act — 4 users x 4 submissions = 16 calls; the 16th exceeds the IP bucket.
    const statuses: number[] = [];
    let limited: Response | null = null;
    for (let i = 0; i < 16; i++) {
      if (i % 4 === 0) {
        const userId = await seedUser(`ip-bucket-${i}`);
        H.session = { user: { id: userId } };
      }
      const res = await POST(
        postKeyRequest({ provider: "openai", apiKey: OPENAI_KEY }, SHARED_IP),
      );
      statuses.push(res.status);
      if (res.status === 429) limited = res;
      await res.json().catch(() => null);
    }

    // Assert — first 15 pass, the 16th is rate-limited by IP despite each user
    // sitting well under the per-user limit.
    expect(statuses.slice(0, 15).every((s) => s === 200)).toBe(true);
    expect(statuses[15]).toBe(429);
    expect(limited?.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("DELETE /api/keys", () => {
  it("removes the stored key for the provider", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    stubProviderFetch(200);
    await POST(postKeyRequest({ provider: "openai", apiKey: OPENAI_KEY }));
    expect(await keyRows(userId)).toHaveLength(1);

    const res = await DELETE(deleteKeyRequest("openai"));
    expect(res.status).toBe(200);
    expect(await keyRows(userId)).toHaveLength(0);
  });

  it("is idempotent — deleting a provider you never had still returns 200", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    const res = await DELETE(deleteKeyRequest("anthropic"));
    expect(res.status).toBe(200);
  });

  it("only deletes the caller's own key", async () => {
    const owner = await seedUser("owner");
    const other = await seedUser("other");
    H.session = { user: { id: owner } };
    stubProviderFetch(200);
    await POST(postKeyRequest({ provider: "openai", apiKey: OPENAI_KEY }));

    // A different user deleting 'openai' must not touch the owner's row.
    H.session = { user: { id: other } };
    await DELETE(deleteKeyRequest("openai"));

    const remaining = await dbProxy
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.userId, owner), eq(apiKeys.provider, "openai")));
    expect(remaining).toHaveLength(1);
  });
});
