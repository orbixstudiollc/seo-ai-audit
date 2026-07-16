"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/audit/ratelimit";
import { ImportError, importFromUrl } from "@/lib/import";
import { parseArticleListCsv } from "@/lib/csv/parseArticleList";
import { createDocument } from "./documents";

/**
 * Bulk CSV import: fetch (SSRF-guarded, via lib/import — the same pipeline
 * the single-URL form uses) + create a document for each row in the CSV.
 *
 * Deliberately calls lib/import's `importFromUrl` directly rather than going
 * through app/actions/import.ts's `importArticleFromUrl` — that action's
 * 10-per-minute rate limit is sized for a human re-submitting the single-URL
 * form, not for one request that itself fans out to N URLs. The real abuse
 * guard here is the CSV row cap (lib/csv/parseArticleList) plus this
 * action's own coarser per-upload limit below.
 */

// A handful of uploads per 10 minutes is generous for a real workflow (a
// content team batching a week's URLs) and expensive to abuse (each upload
// can drive up to MAX_ARTICLE_LIST_ROWS real outbound fetches).
const BULK_USER_LIMIT = 3;
const BULK_USER_WINDOW_SEC = 600;

// Comfortably more than MAX_ARTICLE_LIST_ROWS rows of "url,title" ever need.
const MAX_CSV_CHARS = 100_000;

export interface BulkImportCreated {
  url: string;
  title: string;
  documentId: string;
}

export interface BulkImportFailed {
  url: string;
  reason: string;
}

export interface BulkImportResult {
  /** False only when nothing was attempted at all (auth/rate-limit/parse failure). */
  ok: boolean;
  created: BulkImportCreated[];
  failed: BulkImportFailed[];
  /** Non-fatal per-row parser complaints (e.g. a skipped row with no url). */
  warnings: string[];
  /** Set when the batch never started; created/failed are always empty alongside it. */
  fatalError: string | null;
}

function fatal(message: string): BulkImportResult {
  return { ok: false, created: [], failed: [], warnings: [], fatalError: message };
}

export async function bulkImportArticles(csvText: string): Promise<BulkImportResult> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return fatal("You need to be signed in to bulk import.");
  }

  if (csvText.length > MAX_CSV_CHARS) {
    return fatal(`That file is too large — bulk uploads are capped at ${MAX_CSV_CHARS.toLocaleString()} characters.`);
  }

  const limit = checkRateLimit(`bulk-import:user:${session.user.id}`, BULK_USER_LIMIT, BULK_USER_WINDOW_SEC);
  if (!limit.allowed) {
    return fatal(`Too many bulk uploads — try again in ${Math.ceil(limit.retryAfterSec / 60)} min.`);
  }

  const { rows, warnings, fatalError } = parseArticleListCsv(csvText);
  if (fatalError) {
    return { ok: false, created: [], failed: [], warnings, fatalError };
  }

  const created: BulkImportCreated[] = [];
  const failed: BulkImportFailed[] = [];

  // Sequential: each row is a real outbound fetch through the SSRF guard.
  // Running them one at a time keeps this from becoming its own parallel
  // fan-out on top of the already-applied row cap and per-upload rate limit.
  for (const row of rows) {
    try {
      const article = await importFromUrl(row.url);
      const documentId = await createDocument({
        title: row.title ?? undefined,
        source: "url",
        sourceUrl: article.finalUrl,
        rawContent: article.contentHtml,
      });
      created.push({ url: row.url, title: row.title ?? article.title, documentId });
    } catch (err) {
      const reason = err instanceof ImportError ? err.message : "Could not fetch or create this document.";
      failed.push({ url: row.url, reason });
    }
  }

  return { ok: true, created, failed, warnings, fatalError: null };
}
