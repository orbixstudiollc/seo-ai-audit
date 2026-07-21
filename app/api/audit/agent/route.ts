import { computeParsedDocument } from "@aeo/scoring";
import { z } from "zod";
import { clientIp } from "@/lib/audit/httpHelpers";
import { checkRateLimit } from "@/lib/audit/ratelimit";
import { parseAuditUrl } from "@/lib/audit/requestValidation";
import { createSseResponse } from "@/lib/audit/stream";
import { cloudHistoryConfigured, getSupabaseAdmin, resolveOwnerHashFromRequest } from "@/lib/cloud/server";
import { BACKLINKS_EST_COST_USD, runBacklinksLive } from "@/lib/dataforseo/backlinks";
import { dataForSeoConfigured, startOnPageTask, type TechnicalSeoResult } from "@/lib/dataforseo";
import { KEYWORDS_EST_COST_USD, runKeywordsLive } from "@/lib/dataforseo/keywords";
import { LABS_EST_COST_USD, runLabsLive } from "@/lib/dataforseo/labs";
import { fetchArticle, ImportError, type FetchedArticle } from "@/lib/import";
import { cancelSpend, reserveSpend } from "@/lib/providers/budget";
import {
  attachProviderTask,
  latestTask,
  releaseReservation,
  reserveTask,
  taskById,
  type ProviderTaskRow,
} from "@/lib/providers/taskStore";
import type { ActionPlan } from "@/lib/skills/actionPlan";
import { formatAgentEvent } from "@/lib/skills/agentStream";
import { buildAgentPlan, type AgentPlanItem } from "@/lib/skills/agentPlan";
import { detectBusinessType, extractBusinessSignalInput } from "@/lib/skills/businessType";
import { extractHreflangTags, runHreflang } from "@/lib/skills/hreflang";
import { runAiAccess } from "@/lib/skills/aiAccess";
import { runImages } from "@/lib/skills/images";
import { hostOf, runPaidSkill } from "@/lib/skills/paidSkillRunner";
import { buildAgentRollup } from "@/lib/skills/rollup";
import { completeTask, failedTask, toSkillError } from "@/lib/skills/routeHelpers";
import { runSchema } from "@/lib/skills/schema";
import { runSitemap } from "@/lib/skills/sitemap";
import type { AgentStreamEvent, SkillErrorKind, SkillId, SkillScope, SkillTask, SkillTaskStatus } from "@/lib/skills/types";

/**
 * SK3-BE — POST/GET /api/audit/agent, the agent orchestrator (DATA-CONTRACT
 * §9). Fans a business-type-driven plan out across the free deterministic
 * skills (SK1), the paid DataForSEO skills (SK2, called in-process via
 * runPaidSkill — no HTTP self-calls), and a technical-crawl handoff that
 * reuses the exact reserve/start/attach composition app/api/technical-audit
 * already uses (same provider row shape, polled the same way).
 */
export const runtime = "nodejs";
export const maxDuration = 300;

const AGENT_IP_LIMIT_PER_MIN = 2;
const AGENT_IP_LIMIT_PER_DAY = 6;
const PLAN_ONLY_IP_LIMIT_PER_MIN = 6;

const DEFAULT_MAX_SKILLS = 8;
const DEFAULT_MAX_RUN_USD = 0.25;
const DEFAULT_WALL_CLOCK_MS = 180_000;

// The technical-crawl handoff reuses technical-audit's own provider/cost
// shape (see app/api/technical-audit/route.ts) so both endpoints reserve
// and poll the exact same provider_tasks row.
const TECHNICAL_CRAWL_PROVIDER = "dataforseo-onpage";
const TECHNICAL_CRAWL_LEDGER_OPERATION = "on_page_task";
const TECHNICAL_CRAWL_EST_COST_PER_PAGE_USD = 0.0002;
const TECHNICAL_CRAWL_PAGE_LIMIT = 500;

// Owner-scoped scan for "does this owner already have an audit for this
// site" — audit_runs has no host column, so this is a bounded reverse-chron
// scan filtered in JS.
// ponytail: O(scan-limit) per run, fine at today's per-owner audit volume.
// Upgrade path: add a generated host column + index if this ever shows up
// in a slow-query report.
const AUDIT_HOST_SCAN_LIMIT = 20;

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const bodySchema = z.object({
  url: z.string(),
  planOnly: z.boolean().optional(),
});

// -----------------------------------------------------------------------------
// Business-type + plan
// -----------------------------------------------------------------------------

/** Which SkillScope shape a given inline skill needs. */
function scopeForSkill(skillId: SkillId, url: string, keyword: string): SkillScope {
  if (skillId === "labs" || skillId === "backlinks") return { kind: "site", url };
  if (skillId === "keywords") return { kind: "keyword", keyword };
  return { kind: "page", url };
}

async function findLatestAuditIdForHost(
  db: ReturnType<typeof getSupabaseAdmin>,
  ownerHash: string,
  host: string,
): Promise<string | null> {
  if (!host) return null;
  const { data, error } = await db
    .from("audit_runs")
    .select("id,url")
    .eq("owner_hash", ownerHash)
    .order("created_at", { ascending: false })
    .limit(AUDIT_HOST_SCAN_LIMIT);
  if (error || !data) return null;
  const match = (data as { id: string; url: string }[]).find((row) => hostOf(row.url) === host);
  return match?.id ?? null;
}

// -----------------------------------------------------------------------------
// Inline skill execution
// -----------------------------------------------------------------------------

async function runFreeSkill<T>(skillId: SkillId, scope: SkillScope, run: () => Promise<T>): Promise<SkillTask<T>> {
  try {
    const result = await run();
    return completeTask(skillId, scope, result, 1);
  } catch (err) {
    const { kind, message } = toSkillError(err);
    return failedTask(skillId, scope, kind, message) as SkillTask<T>;
  }
}

const NO_PRIOR_AUDIT_MESSAGE = "No prior audit for this site yet — run a full audit first.";

async function runInlineSkill(
  item: AgentPlanItem,
  fetched: FetchedArticle,
  ownerHash: string,
  ledgerAuditId: string | null,
  keyword: string,
): Promise<SkillTask> {
  const url = fetched.finalUrl;
  const scope = scopeForSkill(item.skillId, url, keyword);

  switch (item.skillId) {
    case "schema":
      return runFreeSkill(item.skillId, scope, () => runSchema(url));
    case "sitemap":
      return runFreeSkill(item.skillId, scope, () => runSitemap(url));
    case "images":
      return runFreeSkill(item.skillId, scope, () => runImages(url));
    case "ai-access":
      return runFreeSkill(item.skillId, scope, () => runAiAccess(url));
    case "hreflang":
      return runFreeSkill(item.skillId, scope, () => runHreflang(url));
    case "labs": {
      if (!ledgerAuditId) return failedTask(item.skillId, scope, "invalid_input", NO_PRIOR_AUDIT_MESSAGE);
      const domain = hostOf(url);
      const { task } = await runPaidSkill({
        ownerHash,
        ledgerAuditId,
        skillId: item.skillId,
        scope,
        fingerprintInput: { domain },
        estCostUsd: LABS_EST_COST_USD,
        call: () => runLabsLive({ domain }),
      });
      return task;
    }
    case "backlinks": {
      if (!ledgerAuditId) return failedTask(item.skillId, scope, "invalid_input", NO_PRIOR_AUDIT_MESSAGE);
      const domain = hostOf(url);
      const { task } = await runPaidSkill({
        ownerHash,
        ledgerAuditId,
        skillId: item.skillId,
        scope,
        fingerprintInput: { domain },
        estCostUsd: BACKLINKS_EST_COST_USD,
        call: () => runBacklinksLive({ domain }),
      });
      return task;
    }
    case "keywords": {
      if (!ledgerAuditId) return failedTask(item.skillId, scope, "invalid_input", NO_PRIOR_AUDIT_MESSAGE);
      // ponytail: the agent has no explicit target keyword — the fetched
      // page's own title stands in as the volume-lookup query. Upgrade path:
      // let the plan/caller supply a real keyword list once keyword research
      // is a first-class agent input.
      const { task } = await runPaidSkill({
        ownerHash,
        ledgerAuditId,
        skillId: item.skillId,
        scope,
        fingerprintInput: { keywords: [keyword.toLowerCase()] },
        estCostUsd: KEYWORDS_EST_COST_USD,
        call: () => runKeywordsLive({ keywords: [keyword] }),
      });
      return task;
    }
    default:
      return failedTask(item.skillId, scope, "server", "Unsupported inline skill.");
  }
}

function skippedTask(item: AgentPlanItem, url: string, keyword: string): SkillTask {
  return failedTask(
    item.skillId,
    scopeForSkill(item.skillId, url, keyword),
    "server",
    "Skipped — the run's wall-clock budget was exhausted before this skill could start.",
  );
}

// -----------------------------------------------------------------------------
// Technical-crawl handoff (same reserve/start/attach composition as
// app/api/technical-audit/route.ts, not extracted — see CARRY-FORWARD note).
// -----------------------------------------------------------------------------

type HandoffOutcome = { mode: "handoff"; taskId: string } | { mode: "inline"; task: SkillTask };

async function startTechnicalCrawlHandoff(
  ownerHash: string,
  ledgerAuditId: string | null,
  url: string,
): Promise<HandoffOutcome> {
  const scope: SkillScope = { kind: "site", url };
  if (!ledgerAuditId) {
    return { mode: "inline", task: failedTask("technical-crawl", scope, "invalid_input", NO_PRIOR_AUDIT_MESSAGE) };
  }
  if (!dataForSeoConfigured()) {
    return { mode: "inline", task: failedTask("technical-crawl", scope, "provider_unavailable", "Technical crawl provider is not configured.") };
  }

  const key = { ownerHash, auditId: ledgerAuditId, provider: TECHNICAL_CRAWL_PROVIDER };
  const existing = await latestTask(key);
  if (existing.row) return { mode: "handoff", taskId: existing.row.id };

  const target = hostOf(url);
  const spend = {
    ownerHash,
    auditId: ledgerAuditId,
    provider: TECHNICAL_CRAWL_PROVIDER,
    operation: TECHNICAL_CRAWL_LEDGER_OPERATION,
    estCostUsd: TECHNICAL_CRAWL_PAGE_LIMIT * TECHNICAL_CRAWL_EST_COST_PER_PAGE_USD,
  };
  const budget = await reserveSpend(spend);
  if (!budget.allowed) {
    return { mode: "inline", task: failedTask("technical-crawl", scope, "budget_exceeded", "Budget cap reached.") };
  }

  const reservation = await reserveTask(key, { target, maxCrawlPages: TECHNICAL_CRAWL_PAGE_LIMIT });
  if (reservation.error || !reservation.row) {
    await cancelSpend(spend);
    const concurrent = await latestTask(key);
    if (concurrent.row) return { mode: "handoff", taskId: concurrent.row.id };
    return { mode: "inline", task: failedTask("technical-crawl", scope, "server", "Could not reserve the crawl task.") };
  }

  let started;
  try {
    started = await startOnPageTask({ target, maxCrawlPages: TECHNICAL_CRAWL_PAGE_LIMIT });
  } catch {
    await releaseReservation(ownerHash, reservation.row.id);
    await cancelSpend(spend);
    return { mode: "inline", task: failedTask("technical-crawl", scope, "fetch_failed", "Could not start the technical crawl.") };
  }

  const { row: inserted, error: insertError } = await attachProviderTask(ownerHash, reservation.row.id, started.taskId, {
    costUsd: started.costUsd,
  });
  if (insertError || !inserted) {
    return { mode: "inline", task: failedTask("technical-crawl", scope, "server", "Could not persist the crawl task.") };
  }
  return { mode: "handoff", taskId: inserted.id };
}

/** Maps a technical-audit provider_tasks row onto the §8 SkillTask envelope.
 * Local (not shared with app/api/skills/technical-crawl/route.ts — the
 * mapping is ~15 lines and both callers read the same row shape; ponytail:
 * duplicated twice, extract if a third caller shows up). */
function technicalCrawlTaskFromRow(row: ProviderTaskRow): SkillTask<TechnicalSeoResult> {
  const meta = row.result_meta ?? {};
  const status: SkillTaskStatus =
    row.status === "complete" || row.status === "failed" || row.status === "running" ? row.status : "queued";
  const task: SkillTask<TechnicalSeoResult> = {
    id: row.id,
    skillId: "technical-crawl",
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

// -----------------------------------------------------------------------------
// The run itself
// -----------------------------------------------------------------------------

interface RunAgentInput {
  ownerHash: string;
  url: string;
  planOnly: boolean;
}

function classifyFetchFailure(err: unknown): { kind: SkillErrorKind; message: string } {
  if (err instanceof ImportError) {
    const kind: SkillErrorKind = err.kind === "blocked" ? "invalid_input" : err.kind === "not_html" || err.kind === "too_large" ? "unsupported_content" : "fetch_failed";
    return { kind, message: err.message };
  }
  return { kind: "server", message: "Unexpected error." };
}

async function runAgent(input: RunAgentInput, write: (event: AgentStreamEvent) => void, signal: AbortSignal): Promise<void> {
  const db = getSupabaseAdmin();
  const runId = crypto.randomUUID();

  let fetched: FetchedArticle;
  try {
    fetched = await fetchArticle(input.url, { signal });
  } catch (err) {
    const { kind, message } = classifyFetchFailure(err);
    write({ type: "agent:error", kind, message });
    if (!input.planOnly) {
      await db.from("agent_runs").insert({
        owner_hash: input.ownerHash,
        id: runId,
        url: input.url,
        business_type: "general",
        status: "failed",
        plan: [],
        skill_results: {},
        pending_task_ids: [],
        est_cost_usd: 0,
      });
    }
    return;
  }

  let runRowInserted = false;
  try {
  const doc = computeParsedDocument(fetched.html, true);
  const signalInput = extractBusinessSignalInput(fetched.html, doc.plainText);
  const detection = detectBusinessType(signalInput);
  const hasAlternates = extractHreflangTags(fetched.html).length > 0;

  const caps = { maxSkills: envInt("AGENT_MAX_SKILLS", DEFAULT_MAX_SKILLS), maxRunUsd: envFloat("AGENT_MAX_RUN_USD", DEFAULT_MAX_RUN_USD) };
  const ledgerAuditId = await findLatestAuditIdForHost(db, input.ownerHash, hostOf(fetched.finalUrl));

  let plan = buildAgentPlan({ businessType: detection.type, hasAlternates, caps });
  // No prior audit for this site -> every paid/handoff item is unrunnable
  // (runPaidSkill and the crawl handoff both require a real audit_runs.id).
  if (!ledgerAuditId) plan = plan.filter((item) => item.estCostUsd === 0);

  write({ type: "agent:plan", runId, businessType: detection.type, skills: plan });

  if (input.planOnly) {
    write({ type: "agent:done" });
    return;
  }

  const estCostUsd = plan.reduce((sum, item) => sum + item.estCostUsd, 0);
  await db.from("agent_runs").insert({
    owner_hash: input.ownerHash,
    id: runId,
    url: fetched.finalUrl,
    business_type: detection.type,
    status: "running",
    plan,
    skill_results: {},
    pending_task_ids: [],
    est_cost_usd: estCostUsd,
  });
  runRowInserted = true;

  const skillResults: Record<string, SkillTask> = {};
  const pendingTaskIds: string[] = [];
  let actualCostUsd = 0;
  const keyword = (fetched.title || hostOf(fetched.finalUrl) || fetched.finalUrl).slice(0, 200);
  const wallClockMs = envInt("AGENT_WALL_CLOCK_MS", DEFAULT_WALL_CLOCK_MS);
  const deadline = Date.now() + wallClockMs;

  const persist = async (patch: Record<string, unknown>): Promise<void> => {
    await db.from("agent_runs").update({ ...patch, updated_at: new Date().toISOString() }).eq("owner_hash", input.ownerHash).eq("id", runId);
  };

  const inlineItems = plan.filter((item) => item.mode === "inline");
  const handoffItems = plan.filter((item) => item.mode === "handoff");

  for (let i = 0; i < inlineItems.length; i++) {
    const item = inlineItems[i];
    if (Date.now() >= deadline) {
      // Skipped skills must still reach the client as terminal skill-done
      // events (failed task), or their rows strand as "Queued" forever in
      // both the live stream and every saved snapshot of it.
      for (const remaining of inlineItems.slice(i)) {
        const task = skippedTask(remaining, fetched.finalUrl, keyword);
        skillResults[remaining.skillId] = task;
        write({ type: "agent:skill-done", skillId: remaining.skillId, task });
      }
      await persist({ skill_results: skillResults, actual_cost_usd: actualCostUsd });
      break;
    }
    write({ type: "agent:skill-start", skillId: item.skillId });
    const task = await runInlineSkill(item, fetched, input.ownerHash, ledgerAuditId, keyword);
    skillResults[item.skillId] = task;
    actualCostUsd += task.costUsd;
    write({ type: "agent:skill-done", skillId: item.skillId, task });
    await persist({ skill_results: skillResults, actual_cost_usd: actualCostUsd });
  }

  for (const item of handoffItems) {
    const outcome = await startTechnicalCrawlHandoff(input.ownerHash, ledgerAuditId, fetched.finalUrl);
    if (outcome.mode === "handoff") {
      pendingTaskIds.push(outcome.taskId);
      write({ type: "agent:skill-handoff", skillId: item.skillId, taskId: outcome.taskId });
    } else {
      skillResults[item.skillId] = outcome.task;
      actualCostUsd += outcome.task.costUsd;
      write({ type: "agent:skill-done", skillId: item.skillId, task: outcome.task });
    }
    await persist({ skill_results: skillResults, pending_task_ids: pendingTaskIds, actual_cost_usd: actualCostUsd });
  }

  const actionPlan = buildAgentRollup({ url: fetched.finalUrl, skillResults });
  write({ type: "agent:rollup", runId, actionPlan, pendingTaskIds });

  await persist({ action_plan: actionPlan, status: "complete" });
  write({ type: "agent:done" });
  } catch {
    // Any unexpected throw past the fetch (HTML parsing, detection, DB
    // writes, rollup) must still tell the client (§9: agent:error, then
    // nothing) AND leave the durable row terminal — never stuck "running".
    write({ type: "agent:error", kind: "server", message: "The agent run failed unexpectedly." });
    if (!input.planOnly) {
      try {
        if (runRowInserted) {
          await db.from("agent_runs").update({ status: "failed", updated_at: new Date().toISOString() }).eq("owner_hash", input.ownerHash).eq("id", runId);
        } else {
          await db.from("agent_runs").insert({
            owner_hash: input.ownerHash, id: runId, url: input.url, business_type: "general",
            status: "failed", plan: [], skill_results: {}, pending_task_ids: [], est_cost_usd: 0,
          });
        }
      } catch { /* The stream already carried the error; a failed status write must not mask it. */ }
    }
  }
}

// -----------------------------------------------------------------------------
// POST — start a run (or a zero-spend plan-only dry run)
// -----------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  const parsedBody = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsedBody.success) return json(400, { error: "invalid_url" });
  const targetUrl = parseAuditUrl(parsedBody.data.url);
  if (!targetUrl) return json(400, { error: "invalid_url" });
  const planOnly = parsedBody.data.planOnly ?? false;

  const ip = clientIp(request);
  if (planOnly) {
    const minute = checkRateLimit(`agent:plan:ip:min:${ip}`, PLAN_ONLY_IP_LIMIT_PER_MIN, 60);
    if (!minute.allowed) return json(429, { error: "rate_limit", retryAfter: minute.retryAfterSec });
  } else {
    const minute = checkRateLimit(`agent:run:ip:min:${ip}`, AGENT_IP_LIMIT_PER_MIN, 60);
    const day = minute.allowed ? checkRateLimit(`agent:run:ip:day:${ip}`, AGENT_IP_LIMIT_PER_DAY, 86_400) : minute;
    if (!minute.allowed || !day.allowed) {
      return json(429, { error: "rate_limit", retryAfter: Math.max(minute.retryAfterSec, day.retryAfterSec) });
    }
  }

  if (!cloudHistoryConfigured()) return json(503, { error: "cloud_unavailable" });
  const ownerHash = await resolveOwnerHashFromRequest(request);
  if (ownerHash === null) return json(401, { error: "invalid_owner" });

  return createSseResponse<AgentStreamEvent>(formatAgentEvent, (write, signal) =>
    runAgent({ ownerHash, url: targetUrl.toString(), planOnly }, write, signal),
  );
}

// -----------------------------------------------------------------------------
// GET ?runId= — owner-gated read + lazy pending-task reconciliation
// -----------------------------------------------------------------------------

interface AgentRunRow {
  owner_hash: string;
  id: string;
  url: string;
  business_type: string;
  status: string;
  plan: AgentPlanItem[];
  skill_results: Record<string, SkillTask>;
  pending_task_ids: string[];
  action_plan: ActionPlan | null;
  est_cost_usd: number;
  actual_cost_usd: number | null;
  created_at: string;
  updated_at: string;
}

export async function GET(request: Request): Promise<Response> {
  if (!cloudHistoryConfigured()) return json(503, { error: "cloud_unavailable" });
  const ownerHash = await resolveOwnerHashFromRequest(request);
  if (ownerHash === null) return json(401, { error: "invalid_owner" });

  const runId = new URL(request.url).searchParams.get("runId");
  if (!runId || runId.length > 4096) return json(400, { error: "invalid_run_id" });

  const db = getSupabaseAdmin();
  const { data, error } = await db.from("agent_runs").select("*").eq("owner_hash", ownerHash).eq("id", runId).maybeSingle();
  if (error) return json(503, { error: "cloud_read_failed" });
  if (!data) return json(404, { error: "run_not_found" });

  let run = data as AgentRunRow;
  const pendingIds = Array.isArray(run.pending_task_ids) ? run.pending_task_ids : [];

  if (pendingIds.length > 0) {
    const skillResults: Record<string, SkillTask> = { ...(run.skill_results ?? {}) };
    const stillPending: string[] = [];
    let changed = false;

    for (const taskId of pendingIds) {
      const { row } = await taskById(ownerHash, taskId);
      if (!row || (row.status !== "complete" && row.status !== "failed")) {
        stillPending.push(taskId);
        continue;
      }
      skillResults["technical-crawl"] = technicalCrawlTaskFromRow(row);
      changed = true;
    }

    if (changed) {
      const technicalResult = skillResults["technical-crawl"]?.result as TechnicalSeoResult | null | undefined;
      const technicalPages = technicalResult ? technicalResult.pages.map((page) => ({ url: page.url, issueKeys: page.issueKeys })) : null;
      const actionPlan = buildAgentRollup({ url: run.url, skillResults, technicalPages });

      const { data: updated, error: updateError } = await db
        .from("agent_runs")
        .update({
          skill_results: skillResults,
          pending_task_ids: stillPending,
          action_plan: actionPlan,
          updated_at: new Date().toISOString(),
        })
        .eq("owner_hash", ownerHash)
        .eq("id", runId)
        .select("*")
        .maybeSingle();
      if (!updateError && updated) run = updated as AgentRunRow;
    }
  }

  return json(200, { run });
}
