"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db/client";
import { apiKeys } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { KeyStatus } from "@/lib/keys/types";

/**
 * Reads the signed-in user's stored key rows for the settings page. Returns
 * only the display-safe fields (never ciphertext/plaintext). Empty array when
 * unauthenticated — the settings page is what enforces the redirect.
 */
export async function getKeyStatuses(): Promise<KeyStatus[]> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return [];

  const rows = await db
    .select({
      provider: apiKeys.provider,
      keyHint: apiKeys.keyHint,
      status: apiKeys.status,
      lastValidatedAt: apiKeys.lastValidatedAt,
      customName: apiKeys.customName,
      baseUrl: apiKeys.baseUrl,
      apiFormat: apiKeys.apiFormat,
      cheapModel: apiKeys.cheapModel,
      strongModel: apiKeys.strongModel,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, session.user.id));

  return rows.map((row) => ({
    provider: row.provider,
    keyHint: row.keyHint,
    status: row.status,
    lastValidatedAt: row.lastValidatedAt ? row.lastValidatedAt.toISOString() : null,
    customName: row.customName,
    baseUrl: row.baseUrl,
    apiFormat: row.apiFormat,
    cheapModel: row.cheapModel,
    strongModel: row.strongModel,
  }));
}
