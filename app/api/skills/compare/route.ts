import { z } from "zod";
import { clientIp } from "@/lib/audit/httpHelpers";
import { checkRateLimit } from "@/lib/audit/ratelimit";
import { createSseResponse } from "@/lib/audit/stream";
import { cloudHistoryConfigured, resolveOwnerHashFromRequest } from "@/lib/cloud/server";
import { dataForSeoConfigured } from "@/lib/dataforseo";
import { taskById } from "@/lib/providers/taskStore";
import { MAX_COMPETITORS, runCompare } from "@/lib/skills/compare";
import { json, paidSkillReadGate, resolveOwnedAudit, rowToSkillTask } from "@/lib/skills/paidSkillRunner";
import type { CompareSkillResult, SkillTask } from "@/lib/skills/types";

/**
 * POST /api/skills/compare (DATA-CONTRACT §8, W8 subset) — unlike the other
 * paid skill routes (serp/keywords/labs/backlinks), one compare run fans out
 * to several page audits that can each take real wall-clock time, so this
 * streams progress instead of completing in one request/response like its
 * siblings. The two frame types below are route-local — NOT a DATA-CONTRACT
 * §9 event union (that's agent-mode's alone) — just this one route's own SSE
 * wire shape, documented here since nothing else defines it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SKILL_ID = "compare" as const;

// Tighter than the shared paidSkillGate's 3/min·10/day (lib/skills/paidSkillRunner.ts)
// — one compare run is worth several page audits plus a SERP call, not one provider call.
const COMPARE_IP_LIMIT_PER_MIN = 2;
const COMPARE_IP_LIMIT_PER_DAY = 5;

type CompareStreamEvent =
  | { type: "compare:progress"; completed: number; total: number }
  | { type: "compare:done"; task: SkillTask<CompareSkillResult> };

function formatCompareEvent(event: CompareStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Rate limit (per-IP, minute + day) -> owner resolve -> provider configured. */
async function compareGate(request: Request): Promise<{ ownerHash: string } | Response> {
  const ip = clientIp(request);
  const minute = checkRateLimit(`skills:compare:ip:min:${ip}`, COMPARE_IP_LIMIT_PER_MIN, 60);
  const day = minute.allowed
    ? checkRateLimit(`skills:compare:ip:day:${ip}`, COMPARE_IP_LIMIT_PER_DAY, 86_400)
    : minute;
  if (!minute.allowed || !day.allowed) {
    return json(429, { error: "rate_limit", retryAfter: Math.max(minute.retryAfterSec, day.retryAfterSec) });
  }
  if (!cloudHistoryConfigured()) return json(503, { error: "cloud_unavailable" });
  const ownerHash = await resolveOwnerHashFromRequest(request);
  if (ownerHash === null) return json(401, { error: "invalid_owner" });
  if (!dataForSeoConfigured()) return json(503, { error: "provider_unavailable" });
  return { ownerHash };
}

const bodySchema = z.object({
  auditId: z.string().min(1).max(4096),
  keyword: z.string().min(1).max(200),
  topN: z.number().int().min(1).max(MAX_COMPETITORS).optional().default(MAX_COMPETITORS),
});

export async function POST(request: Request): Promise<Response> {
  const gate = await compareGate(request);
  if (gate instanceof Response) return gate;
  const { ownerHash } = gate;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json(400, { error: "invalid_scope" });
  const { auditId, keyword, topN } = parsed.data;

  const audit = await resolveOwnedAudit(ownerHash, auditId);
  if (audit instanceof Response) return audit;

  return createSseResponse<CompareStreamEvent>(formatCompareEvent, async (write) => {
    const task = await runCompare({
      ownerHash,
      ledgerAuditId: auditId,
      keyword: keyword.trim(),
      topN,
      myUrl: audit.url,
      emitProgress: (completed, total) => write({ type: "compare:progress", completed, total }),
    });
    write({ type: "compare:done", task });
  });
}

export async function GET(request: Request): Promise<Response> {
  // No rate limit or provider check here (paidSkillReadGate, shared with the
  // other paid skills) — a read of an already-paid-for task shouldn't 429/503
  // just because the provider is briefly unconfigured or the IP is polling.
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
