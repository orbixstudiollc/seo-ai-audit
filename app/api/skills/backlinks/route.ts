import { z } from "zod";
import { BACKLINKS_EST_COST_USD, runBacklinksLive } from "@/lib/dataforseo/backlinks";
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

const SKILL_ID = "backlinks" as const;

const bodySchema = z.object({
  auditId: z.string().min(1).max(4096),
  scope: z.object({ kind: z.literal("site"), url: z.string().url().max(2048) }),
});

export async function POST(request: Request): Promise<Response> {
  const gate = await paidSkillGate(request, SKILL_ID);
  if (gate instanceof Response) return gate;
  const { ownerHash } = gate;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_scope" });
  const { auditId, scope } = parsed.data;
  const targetUrl = new URL(scope.url);
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") return json(400, { error: "invalid_scope" });

  const audit = await resolveOwnedAudit(ownerHash, auditId);
  if (audit instanceof Response) return audit;
  const domain = hostOf(scope.url);
  if (!domain || domain !== hostOf(audit.url)) return json(400, { error: "audit_target_mismatch" });

  const { task, reused } = await runPaidSkill({
    ownerHash,
    ledgerAuditId: auditId,
    skillId: SKILL_ID,
    scope,
    fingerprintInput: { domain },
    estCostUsd: BACKLINKS_EST_COST_USD,
    call: () => runBacklinksLive({ domain }),
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
