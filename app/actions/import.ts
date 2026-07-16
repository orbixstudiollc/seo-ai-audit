"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/audit/ratelimit";
import { ImportError, importFromUrl, PASTE_FALLBACK_MESSAGE } from "@/lib/import";
import type { ImportErrorKind } from "@/lib/import";

/**
 * Server action wrapping the lib/import pipeline (SSRF guard -> capped fetch
 * -> Readability). This is the only place the server fetches a user-supplied
 * URL, so it is auth-gated and rate-limited, and it NEVER throws — every
 * failure comes back as a typed { kind, userMessage } the form can render
 * next to its paste fallback.
 */

// Each import is a server-side fetch of a remote URL on the user's behalf —
// keep it light. 10/min per user, refilled evenly (token bucket).
const IMPORT_USER_LIMIT = 10;
const IMPORT_USER_WINDOW_SEC = 60;

const urlSchema = z.url().max(2000);

export type ImportFailureKind =
  | ImportErrorKind
  | "unauthorized"
  | "invalid_url"
  | "rate_limited";

export type ImportArticleResult =
  | {
      ok: true;
      title: string;
      contentHtml: string;
      wordCount: number;
      finalUrl: string;
    }
  | { ok: false; kind: ImportFailureKind; userMessage: string };

export async function importArticleFromUrl(url: string): Promise<ImportArticleResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return {
      ok: false,
      kind: "unauthorized",
      userMessage: "You need to be signed in to import a URL.",
    };
  }

  const parsed = urlSchema.safeParse(url);
  if (!parsed.success) {
    return {
      ok: false,
      kind: "invalid_url",
      userMessage: "That doesn't look like a valid URL — paste the article text instead.",
    };
  }

  const limit = checkRateLimit(
    `import:user:${session.user.id}`,
    IMPORT_USER_LIMIT,
    IMPORT_USER_WINDOW_SEC,
  );
  if (!limit.allowed) {
    return {
      ok: false,
      kind: "rate_limited",
      userMessage: `Too many imports — try again in ${limit.retryAfterSec}s, or paste the article text instead.`,
    };
  }

  try {
    const article = await importFromUrl(parsed.data);
    return {
      ok: true,
      title: article.title,
      contentHtml: article.contentHtml,
      wordCount: article.wordCount,
      finalUrl: article.finalUrl,
    };
  } catch (err) {
    if (err instanceof ImportError) {
      return { ok: false, kind: err.kind, userMessage: err.message };
    }
    return { ok: false, kind: "fetch_failed", userMessage: PASTE_FALLBACK_MESSAGE };
  }
}
