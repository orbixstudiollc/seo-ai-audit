import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { apiKeys } from "@/db/schema";
import { auth } from "@/lib/auth";
import { encryptApiKey, keyHint } from "@/lib/crypto/apiKeys";
import {
  CUSTOM_API_FORMATS,
  KEY_PROVIDERS,
  type ApiKeyProvider,
  type ApiKeyStatus,
  type KeyStatus,
} from "@/lib/keys/types";
import { validateProviderKey } from "@/lib/keys/validateProvider";
import type { CustomProviderConfig } from "@/lib/audit/provider";
import { checkRateLimit } from "@/lib/audit/ratelimit";

// encryptApiKey pulls in node:crypto, which forces the Node runtime (never Edge).
export const runtime = "nodejs";

// Key writes are rare and each one costs a live provider-validation call, so
// the per-user bucket is tight; the wider per-IP bucket blunts shared-host
// abuse (same split as /api/audit).
const KEYS_USER_LIMIT = 5;
const KEYS_IP_LIMIT = 15;
const KEYS_WINDOW_SEC = 60;

const providerSchema = z.enum(KEY_PROVIDERS);

const namedProviderBodySchema = z.object({
  provider: z.enum(["openai", "anthropic"]),
  apiKey: z
    .string()
    .trim()
    .min(20)
    .max(300)
    // Cheap client-side-shape gate so obvious garbage never reaches the
    // provider (and never becomes a free oracle for testing random strings).
    // Both OpenAI (sk-...) and Anthropic (sk-ant-...) keys share this prefix.
    .refine((value) => value.startsWith("sk-"), { message: "API key looks malformed." }),
});

// Arbitrary third-party endpoints don't share a key-prefix convention (some
// proxies mint their own formats), so custom keys only get a length gate, not
// the sk- shape check above.
const customProviderBodySchema = z.object({
  provider: z.literal("custom"),
  apiKey: z.string().trim().min(1).max(300),
  customName: z.string().trim().min(1).max(100),
  // http(s)-only — basic input hygiene, not an SSRF guard (see the ponytail
  // comment on CustomProviderConfig in lib/audit/provider.ts for why this
  // endpoint is deliberately NOT IP-range-restricted the way URL-import is).
  baseUrl: z.url({ protocol: /^https?$/ }).max(500),
  apiFormat: z.enum(CUSTOM_API_FORMATS),
  cheapModel: z.string().trim().min(1).max(200),
  strongModel: z.string().trim().min(1).max(200),
});

const postBodySchema = z.discriminatedUnion("provider", [
  namedProviderBodySchema,
  customProviderBodySchema,
]);

type ErrorKind =
  | "unauthorized"
  | "validation"
  | "invalid"
  | "rate_limited"
  | "provider_error"
  | "network"
  | "server_error";

// Deliberately generic, provider-text-free messages. A raw provider error can
// embed request config (and thus key-adjacent data), so it never reaches the
// client, the logs, or Sentry — hence zero console.* in this module.
// TODO(reconcile): fold into lib/audit/errors.ts `mapProviderError` once that
// sibling module lands; keep the same typed-kind taxonomy so both agree.
const ERROR_MESSAGES: Record<ErrorKind, string> = {
  unauthorized: "You must be signed in to manage API keys.",
  validation: "Invalid request.",
  invalid:
    "The provider rejected that key. Make sure it's a platform API key " +
    "(platform.openai.com / console.anthropic.com), not a ChatGPT Plus or Claude.ai subscription.",
  rate_limited:
    "The provider is rate-limiting key validation right now. Wait a moment and try again.",
  provider_error: "The provider couldn't validate the key right now. Try again shortly.",
  network: "Couldn't reach the provider to validate the key. Check your connection and retry.",
  server_error: "Something went wrong saving your key. Try again.",
};

const ERROR_STATUS: Record<ErrorKind, number> = {
  unauthorized: 401,
  validation: 400,
  invalid: 400,
  rate_limited: 429,
  provider_error: 502,
  network: 504,
  server_error: 500,
};

function errorResponse(kind: ErrorKind): Response {
  return Response.json({ error: { kind, message: ERROR_MESSAGES[kind] } }, { status: ERROR_STATUS[kind] });
}

async function upsertKey(
  userId: string,
  provider: ApiKeyProvider,
  apiKey: string,
  status: ApiKeyStatus,
  custom: CustomProviderConfig & { customName: string } | null,
): Promise<KeyStatus> {
  const ciphertext = encryptApiKey(apiKey, userId);
  const hint = keyHint(apiKey);
  const now = new Date();

  const customColumns = custom
    ? {
        customName: custom.customName,
        baseUrl: custom.baseUrl,
        apiFormat: custom.apiFormat,
        cheapModel: custom.cheapModel,
        strongModel: custom.strongModel,
      }
    : { customName: null, baseUrl: null, apiFormat: null, cheapModel: null, strongModel: null };

  // UNIQUE(user_id, provider) → adding a key for a provider you already have
  // replaces it (re-encrypts under the current key, refreshes hint/status).
  const [row] = await db
    .insert(apiKeys)
    .values({ userId, provider, ciphertext, keyHint: hint, status, lastValidatedAt: now, ...customColumns })
    .onConflictDoUpdate({
      target: [apiKeys.userId, apiKeys.provider],
      set: { ciphertext, keyHint: hint, status, lastValidatedAt: now, updatedAt: now, ...customColumns },
    })
    .returning({
      provider: apiKeys.provider,
      keyHint: apiKeys.keyHint,
      status: apiKeys.status,
      lastValidatedAt: apiKeys.lastValidatedAt,
      customName: apiKeys.customName,
      baseUrl: apiKeys.baseUrl,
      apiFormat: apiKeys.apiFormat,
      cheapModel: apiKeys.cheapModel,
      strongModel: apiKeys.strongModel,
    });

  return {
    provider: row.provider,
    keyHint: row.keyHint,
    status: row.status,
    lastValidatedAt: row.lastValidatedAt ? row.lastValidatedAt.toISOString() : null,
    customName: row.customName,
    baseUrl: row.baseUrl,
    apiFormat: row.apiFormat,
    cheapModel: row.cheapModel,
    strongModel: row.strongModel,
  };
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return errorResponse("unauthorized");

  // Rate-limit BEFORE the provider ping so this endpoint can't be used as a
  // free oracle for probing stolen keys (per-user AND per-IP).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const userLimit = checkRateLimit(`keys:user:${session.user.id}`, KEYS_USER_LIMIT, KEYS_WINDOW_SEC);
  const ipLimit = checkRateLimit(`keys:ip:${ip}`, KEYS_IP_LIMIT, KEYS_WINDOW_SEC);
  const limited = !userLimit.allowed ? userLimit : !ipLimit.allowed ? ipLimit : null;
  if (limited) {
    return Response.json(
      {
        error: {
          kind: "rate_limited",
          message: `Too many key submissions. Retry in ${limited.retryAfterSec}s.`,
        },
      },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse("validation");
  }

  const parsed = postBodySchema.safeParse(rawBody);
  if (!parsed.success) return errorResponse("validation");

  const { provider, apiKey } = parsed.data;
  const custom: (CustomProviderConfig & { customName: string }) | null =
    parsed.data.provider === "custom"
      ? {
          customName: parsed.data.customName,
          baseUrl: parsed.data.baseUrl,
          apiFormat: parsed.data.apiFormat,
          cheapModel: parsed.data.cheapModel,
          strongModel: parsed.data.strongModel,
        }
      : null;

  let outcome;
  try {
    outcome = await validateProviderKey(provider, apiKey, custom ?? undefined);
  } catch {
    // Timeout/abort or DNS/connection failure — never a key problem itself.
    return errorResponse("network");
  }

  // Store on success OR on "quota" (the key authenticates; it's just out of
  // credit). Never store an invalid/rate-limited/errored key.
  if (!outcome.ok && outcome.kind !== "quota") {
    return errorResponse(outcome.kind);
  }
  const status: ApiKeyStatus = outcome.ok ? "valid" : "quota";

  try {
    const stored = await upsertKey(session.user.id, provider, apiKey, status, custom);
    return Response.json(stored, { status: 200 });
  } catch {
    return errorResponse("server_error");
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return errorResponse("unauthorized");

  const providerParam = new URL(req.url).searchParams.get("provider");
  const parsed = providerSchema.safeParse(providerParam);
  if (!parsed.success) return errorResponse("validation");

  try {
    await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.userId, session.user.id), eq(apiKeys.provider, parsed.data)));
  } catch {
    return errorResponse("server_error");
  }

  // Idempotent: deleting a provider you never had is still a 200.
  return Response.json({ provider: parsed.data }, { status: 200 });
}
