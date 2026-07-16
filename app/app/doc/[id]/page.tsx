import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db/client";
import { audits, documents } from "@/db/schema";
import type {
  AuditFindings,
  AuditRewrites,
  WorkbenchAudit,
  WorkbenchDocument,
} from "@/lib/audit/types";
import type { ScoreBreakdown } from "@aeo/scoring";
import { Workbench } from "./Workbench";

// Auth reads cookies, so this route is request-time dynamic. Being explicit
// also guarantees the lazy db client is never hit during `next build`.
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AuditRow = typeof audits.$inferSelect;

function mapAudit(row: AuditRow): WorkbenchAudit {
  return {
    id: row.id,
    status: row.status,
    scoresStatus: row.scoresStatus,
    rewritesStatus: row.rewritesStatus,
    // jsonb columns are typed as unknown; these are our own writes shaped by
    // the /api/audit route against the shared contracts in lib/audit/types.
    scores: (row.scores as ScoreBreakdown | null) ?? null,
    findings: (row.findings as AuditFindings | null) ?? null,
    rewrites: (row.rewrites as AuditRewrites | null) ?? null,
    modelId: row.modelId,
    createdAt: row.createdAt.toISOString(),
  };
}

export default async function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, session.user.id)))
    .limit(1);

  if (!doc) notFound();

  const [latestAudit] = await db
    .select()
    .from(audits)
    .where(eq(audits.documentId, doc.id))
    .orderBy(desc(audits.createdAt))
    .limit(1);

  const wbDocument: WorkbenchDocument = {
    id: doc.id,
    title: doc.title,
    source: doc.source,
    sourceUrl: doc.sourceUrl,
    rawContent: doc.rawContent,
    wordCount: doc.wordCount,
  };

  return <Workbench document={wbDocument} initialAudit={latestAudit ? mapAudit(latestAudit) : null} />;
}
