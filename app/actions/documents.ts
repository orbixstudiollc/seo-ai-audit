"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  computeParsedDocument,
  LENSES,
  type Lens,
  type ParsedDocument,
} from "@aeo/scoring";
import { db } from "@/db/client";
import { audits, documents } from "@/db/schema";
import { auth } from "@/lib/auth";
import { EEAT_SIGNAL } from "@/lib/audit/signalMeta";

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

export type DocumentRow = typeof documents.$inferSelect;

/** Read model for the dashboard list: a document plus its most recent completed audit's four lens scores and E-E-A-T signal score (null if never audited). */
export interface DocumentListItem {
  id: string;
  title: string;
  source: "paste" | "url";
  sourceUrl: string | null;
  wordCount: number;
  updatedAt: Date;
  latestScores: Record<Lens, number> | null;
  eeatScore: number | null;
}

// Trust-boundary validation. Server actions are a public RPC surface — every
// input is validated here even though the UI also constrains it.
const MAX_CONTENT_CHARS = 500_000;

const createDocumentSchema = z.object({
  title: z.string().max(200).optional(),
  source: z.enum(["paste", "url"]),
  sourceUrl: z.url().max(2000).optional(),
  rawContent: z.string().min(1).max(MAX_CONTENT_CHARS),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  rawContent: z.string().min(1).max(MAX_CONTENT_CHARS).optional(),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

async function requireUserId(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    throw new Error("Unauthorized.");
  }
  return session.user.id;
}

/** sha256 of the canonicalized content — same canonicalization the audit cache key uses, so a document's hash lines up with its audits' content_hash. */
function contentHashOf(parsed: ParsedDocument): string {
  return createHash("sha256").update(parsed.raw).digest("hex");
}

/** Fall back to the first heading, then the first few words, so a paste with no explicit title still gets a sensible label. */
function deriveTitle(explicit: string | undefined, parsed: ParsedDocument): string {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed.slice(0, 200);

  const firstHeading = parsed.headings[0]?.text.trim();
  if (firstHeading) return firstHeading.slice(0, 200);

  const firstWords = parsed.plainText.trim().split(/\s+/).slice(0, 10).join(" ");
  return firstWords ? firstWords.slice(0, 200) : "Untitled audit";
}

/** Structurally narrow an `audits.scores` jsonb blob (typed `unknown`) down to the four lens scores, or null if the shape is unexpected. */
function lensSummary(scores: unknown): Record<Lens, number> | null {
  if (scores === null || typeof scores !== "object") return null;
  const lenses = (scores as { lenses?: unknown }).lenses;
  if (lenses === null || typeof lenses !== "object") return null;

  const record = lenses as Record<string, unknown>;
  const summary = {} as Record<Lens, number>;
  for (const lens of LENSES) {
    const entry = record[lens];
    if (entry === null || typeof entry !== "object") return null;
    const score = (entry as { score?: unknown }).score;
    if (typeof score !== "number") return null;
    summary[lens] = score;
  }
  return summary;
}

/** Structurally narrow an `audits.scores` jsonb blob down to the E-E-A-T (S17) signal score, or null if absent/unexpected shape. */
function eeatScoreOf(scores: unknown): number | null {
  if (scores === null || typeof scores !== "object") return null;
  const signals = (scores as { signals?: unknown }).signals;
  if (signals === null || typeof signals !== "object") return null;
  const eeat = (signals as Record<string, unknown>)[EEAT_SIGNAL];
  if (eeat === null || typeof eeat !== "object") return null;
  const score = (eeat as { score?: unknown }).score;
  return typeof score === "number" ? score : null;
}

// -----------------------------------------------------------------------
// CRUD — every operation is scoped to the authenticated user. Reads and
// writes both carry `userId` in the WHERE clause, so one user can never
// touch another user's rows even with a guessed id.
// -----------------------------------------------------------------------

export async function createDocument(input: CreateDocumentInput): Promise<string> {
  const userId = await requireUserId();
  const data = createDocumentSchema.parse(input);

  const parsed = computeParsedDocument(data.rawContent, data.source === "url");

  const [row] = await db
    .insert(documents)
    .values({
      userId,
      title: deriveTitle(data.title, parsed),
      source: data.source,
      sourceUrl: data.sourceUrl ?? null,
      // Store the canonicalized form (parsed.raw), not the raw input: the
      // rubric prompt, rewrite hunks, and contentHash below are all derived
      // from the canonical text, so storing anything else lets a smart-quote/
      // em-dash/CRLF paste desync the stored document from what the LLM saw —
      // accept-hunk's `content.includes(hunk.before)` then silently no-ops.
      rawContent: parsed.raw,
      contentHash: contentHashOf(parsed),
      wordCount: parsed.wordCount,
    })
    .returning({ id: documents.id });

  revalidatePath("/app");
  return row.id;
}

export async function listDocuments(): Promise<DocumentListItem[]> {
  const userId = await requireUserId();

  const docs = await db
    .select()
    .from(documents)
    .where(eq(documents.userId, userId))
    .orderBy(desc(documents.updatedAt));

  if (docs.length === 0) return [];

  const completed = await db
    .select({
      documentId: audits.documentId,
      scores: audits.scores,
    })
    .from(audits)
    .where(and(eq(audits.userId, userId), eq(audits.status, "completed")))
    .orderBy(desc(audits.completedAt));

  // ponytail: latest-completed-audit-per-doc resolved with a Map in JS, not a
  // SQL lateral join. One extra indexed query + a first-seen scan; correct and
  // cheap at self-hosted scale. Upgrade to DISTINCT ON / lateral only if a
  // single user ever accumulates tens of thousands of audits.
  const scoresByDoc = new Map<string, unknown>();
  for (const audit of completed) {
    if (!scoresByDoc.has(audit.documentId)) {
      scoresByDoc.set(audit.documentId, audit.scores);
    }
  }

  return docs.map((doc) => ({
    id: doc.id,
    title: doc.title,
    source: doc.source,
    sourceUrl: doc.sourceUrl,
    wordCount: doc.wordCount,
    updatedAt: doc.updatedAt,
    latestScores: lensSummary(scoresByDoc.get(doc.id)),
    eeatScore: eeatScoreOf(scoresByDoc.get(doc.id)),
  }));
}

export async function getDocument(id: string): Promise<DocumentRow | null> {
  const userId = await requireUserId();
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function updateDocument(
  id: string,
  patch: UpdateDocumentInput,
): Promise<DocumentRow> {
  const userId = await requireUserId();
  const data = updateDocumentSchema.parse(patch);

  // Ownership check + we need the existing `source` to know whether re-parsing
  // edited content should treat it as HTML.
  const existing = await getDocument(id);
  if (!existing) {
    throw new Error("Document not found.");
  }

  const values: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() };
  if (data.title !== undefined) {
    values.title = data.title.trim();
  }
  if (data.rawContent !== undefined) {
    const parsed = computeParsedDocument(data.rawContent, existing.source === "url");
    // Same canonical-form rule as createDocument — see the comment there.
    values.rawContent = parsed.raw;
    values.contentHash = contentHashOf(parsed);
    values.wordCount = parsed.wordCount;
  }

  const [row] = await db
    .update(documents)
    .set(values)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)))
    .returning();

  if (!row) {
    throw new Error("Document not found.");
  }

  revalidatePath("/app");
  revalidatePath(`/app/doc/${id}`);
  return row;
}

export async function deleteDocument(id: string): Promise<void> {
  const userId = await requireUserId();
  // FK onDelete: cascade drops the document's audits with it.
  await db
    .delete(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)));
  revalidatePath("/app");
}
