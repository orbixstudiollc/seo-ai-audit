"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import type { ScoreBreakdown } from "@aeo/scoring";
import { db } from "@/db/client";
import { audits } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { AuditFindings, AuditRewrites, WorkbenchAudit } from "@/lib/audit/types";

// audits.id is a uuid (see db/schema.ts). Validating at this trust boundary
// keeps a malformed/guessed id from reaching the query.
const auditIdSchema = z.uuid();

/**
 * Narrow a jsonb column (typed `unknown` by Drizzle) to the object shape this
 * app persisted into it, or null. The route writes a valid ScoreBreakdown /
 * AuditFindings / AuditRewrites, so a light object check is enough here — a
 * corrupt or legacy-shaped row degrades to null rather than crashing the
 * workbench.
 */
function asObject<T>(value: unknown): T | null {
  return value !== null && typeof value === "object" ? (value as T) : null;
}

/**
 * Recovery read for a reconnecting client. Returns the persisted phases of an
 * audit so a dropped SSE stream (tab close, flaky network, LB idle-timeout)
 * resumes from Postgres without re-running — and re-paying for — the LLM
 * calls. This is the read half of the plan's "crash insurance without a
 * queue": the route persists `scores` when call 1 finishes and `rewrites`
 * when call 2 finishes, and a returning client polls this action until the
 * row reaches a terminal `status`.
 *
 * Auth-scoped: the `userId` in the WHERE clause means one user can never read
 * another user's audit even with a guessed id (the audits cache is per-user by
 * design — it holds unpublished draft findings). Returns null when the audit
 * does not exist or is not the caller's.
 */
export async function getAuditStatus(auditId: string): Promise<WorkbenchAudit | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    throw new Error("Unauthorized.");
  }

  const parsed = auditIdSchema.safeParse(auditId);
  if (!parsed.success) {
    return null;
  }

  const [row] = await db
    .select()
    .from(audits)
    .where(and(eq(audits.id, parsed.data), eq(audits.userId, session.user.id)))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    status: row.status,
    scoresStatus: row.scoresStatus,
    rewritesStatus: row.rewritesStatus,
    scores: asObject<ScoreBreakdown>(row.scores),
    findings: asObject<AuditFindings>(row.findings),
    rewrites: asObject<AuditRewrites>(row.rewrites),
    modelId: row.modelId,
    createdAt: row.createdAt.toISOString(),
    error: row.error,
  };
}
