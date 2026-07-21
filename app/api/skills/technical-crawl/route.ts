import type { TechnicalSeoResult } from "@/lib/dataforseo";
import { taskById, type ProviderTaskRow } from "@/lib/providers/taskStore";
import { json, paidSkillReadGate } from "@/lib/skills/paidSkillRunner";
import type { SkillTask, SkillTaskStatus } from "@/lib/skills/types";

/**
 * GET /api/skills/technical-crawl?id= — read-only §8 adapter over the
 * existing technical-audit provider_tasks row (DATA-CONTRACT §8, SK3
 * CARRY-FORWARD). The crawl itself is started by the agent orchestrator's
 * handoff (app/api/audit/agent/route.ts, same reserve/start/attach
 * composition as app/api/technical-audit/route.ts) — this endpoint only maps
 * the already-persisted row onto the SkillTask envelope so agent-mode UI can
 * poll it the same way it polls every other skill. No POST: starting a crawl
 * happens exclusively through the agent handoff or /api/technical-audit.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SKILL_ID = "technical-crawl" as const;

/** Maps a technical-audit provider_tasks row onto the §8 SkillTask envelope.
 * Local, not shared with app/api/audit/agent/route.ts's identical mapper —
 * ~15 lines, duplicated twice; extract if a third caller shows up. */
function rowToTask(row: ProviderTaskRow): SkillTask<TechnicalSeoResult> {
  const meta = row.result_meta ?? {};
  const status: SkillTaskStatus =
    row.status === "complete" || row.status === "failed" || row.status === "running" ? row.status : "queued";
  const task: SkillTask<TechnicalSeoResult> = {
    id: row.id,
    skillId: SKILL_ID,
    scope: { kind: "site" },
    status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    costUsd: typeof meta.costUsd === "number" ? meta.costUsd : 0,
    resultVersion: 1,
    result: status === "complete" ? ((meta.result as TechnicalSeoResult | undefined) ?? null) : null,
  };
  if (status === "failed") {
    task.error = {
      kind: "server",
      message: typeof meta.errorMessage === "string" ? meta.errorMessage : "Technical crawl failed.",
    };
  }
  return task;
}

export async function GET(request: Request): Promise<Response> {
  const gate = await paidSkillReadGate(request);
  if (gate instanceof Response) return gate;
  const { ownerHash } = gate;

  const id = new URL(request.url).searchParams.get("id");
  if (!id || id.length > 4096) return json(400, { error: "invalid_task_id" });

  const { row, error } = await taskById(ownerHash, id);
  if (error) return json(503, { error: "cloud_read_failed" });
  if (!row) return json(404, { error: "task_not_found" });
  return json(200, { task: rowToTask(row) });
}
