import { z } from "zod";
import { SERP_EST_COST_USD, runSerpLive } from "@/lib/dataforseo/serp";
import { taskById } from "@/lib/providers/taskStore";
import {
  hostOf,
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

const SKILL_ID = "serp" as const;

const bodySchema = z.object({
  auditId: z.string().min(1).max(4096),
  scope: z.object({ kind: z.literal("keyword"), keyword: z.string().min(1).max(200) }),
});

export async function POST(request: Request): Promise<Response> {
  const gate = await paidSkillGate(request, SKILL_ID);
  if (gate instanceof Response) return gate;
  const { ownerHash } = gate;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_scope" });
  const { auditId, scope } = parsed.data;

  const audit = await resolveOwnedAudit(ownerHash, auditId);
  if (audit instanceof Response) return audit;
  const ownHost = hostOf(audit.url);
  const keyword = scope.keyword.trim();

  const { task, reused } = await runPaidSkill({
    ownerHash,
    ledgerAuditId: auditId,
    skillId: SKILL_ID,
    scope,
    fingerprintInput: { keyword: keyword.toLowerCase() },
    estCostUsd: SERP_EST_COST_USD,
    call: () => runSerpLive({ keyword, ownHost }),
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
