import { z } from "zod";
import { KEYWORDS_EST_COST_USD, MAX_KEYWORDS, runKeywordsLive } from "@/lib/dataforseo/keywords";
import { taskById } from "@/lib/providers/taskStore";
import {
  json,
  paidSkillGate,
  paidSkillReadGate,
  resolveOwnedAudit,
  rowToSkillTask,
  runPaidSkill,
} from "@/lib/skills/paidSkillRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SKILL_ID = "keywords" as const;

const bodySchema = z.object({
  auditId: z.string().min(1).max(4096),
  scope: z.object({ kind: z.literal("keyword"), keyword: z.string().min(1).max(200) }),
  params: z.object({ keywords: z.array(z.string().min(1).max(200)).min(1).max(MAX_KEYWORDS) }).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const gate = await paidSkillGate(request, SKILL_ID);
  if (gate instanceof Response) return gate;
  const { ownerHash } = gate;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_scope" });
  const { auditId, scope, params } = parsed.data;

  const audit = await resolveOwnedAudit(ownerHash, auditId);
  if (audit instanceof Response) return audit;

  const keywords = (params?.keywords?.length ? params.keywords : [scope.keyword]).map((k) => k.trim());
  const fingerprintKeywords = [...new Set(keywords.map((k) => k.toLowerCase()))].sort();

  const { task, reused } = await runPaidSkill({
    ownerHash,
    ledgerAuditId: auditId,
    skillId: SKILL_ID,
    scope,
    fingerprintInput: { keywords: fingerprintKeywords },
    estCostUsd: KEYWORDS_EST_COST_USD,
    call: () => runKeywordsLive({ keywords }),
  });
  return json(200, { task, reused });
}

export async function GET(request: Request): Promise<Response> {
  const gate = await paidSkillReadGate(request);
  if (gate instanceof Response) return gate;
  const { ownerHash } = gate;

  const id = new URL(request.url).searchParams.get("id");
  if (!id || id.length > 4096) return json(400, { error: "invalid_task_id" });

  const { row, error } = await taskById(ownerHash, id);
  if (error) return json(503, { error: "cloud_read_failed" });
  if (!row || row.request?.skillId !== SKILL_ID) return json(404, { error: "task_not_found" });
  return json(200, { task: rowToSkillTask(row, SKILL_ID) });
}
