import { LENSES, type Lens, type ScoreBreakdown } from "@aeo/scoring";
import { runPageAudit } from "@/lib/audit/pageAudit";
import { createSiteBudget, runConcurrentQueue } from "@/lib/audit/siteGuards";
import type { AuditFindings, AuditStreamEvent } from "@/lib/audit/types";
import { getSupabaseAdmin } from "@/lib/cloud/server";
import { SERP_EST_COST_USD, runSerpLive } from "@/lib/dataforseo/serp";
import { hostOf, runPaidSkill } from "./paidSkillRunner";
import type { CompareSkillResult, SerpSkillResult, SkillTask } from "./types";

/**
 * SK4 — W8 competitor-compare subset. The whole compare (SERP lookup + every
 * competitor's landing-page audit + the owner's own page) is metered as ONE
 * `runPaidSkill` call under skillId "compare": only the SERP lookup actually
 * spends provider budget (`call: () => runSerpLive(...)`), but the persisted
 * `provider_tasks` row is overwritten with the full `CompareSkillResult`
 * before this returns (see `persistCompareResult`) so a repeat request with
 * the identical {keyword, topN} fingerprint reuses the ENTIRE assembled
 * result — competitor audits included — at $0, not just the SERP call.
 * Page audits themselves ride the same free/rate-limited path every
 * single-page audit does (DATA-CONTRACT's existing LLM economics) — they are
 * never separately ledger-gated.
 */

export const MAX_COMPETITORS = 3;

// Mirrors app/api/audit/bulk/route.ts's PAGE_TIMEOUT_MS / PAGE_FETCH_TIMEOUT_MS
// and its per-page timeout-race shape (runPageAudit's call-1 has no abort
// wiring, so a stuck page is raced past rather than cancelled).
const PAGE_TIMEOUT_MS = 45_000;
const PAGE_FETCH_TIMEOUT_MS = 15_000;
// Mirrors bulk's SITE_MAX_CONCURRENCY posture at this much smaller scale
// (≤3 competitors + "mine" — never enough pages for concurrency to matter
// much, but bounding it keeps the outbound-fetch shape consistent with bulk).
const COMPETITOR_CONCURRENCY = 2;
// Generous relative to PAGE_TIMEOUT_MS * ceil(MAX_COMPETITORS / concurrency)
// — runConcurrentQueue's budget exists for bulk's hundreds-of-pages case;
// here it never realistically expires, it's just the parameter the shared
// queue helper requires.
const COMPARE_BUDGET_MS = 150_000;

const MAX_TOP_FINDINGS = 3;

interface PageOutcome {
  scores: Record<Lens, number> | null;
  findings: AuditFindings | null;
  failed: boolean;
  errorMessage: string | null;
}

function toLensScores(breakdown: ScoreBreakdown): Record<Lens, number> {
  return Object.fromEntries(LENSES.map((lens) => [lens, breakdown.lenses[lens].score])) as Record<Lens, number>;
}

/**
 * Runs one page through runPageAudit under a hard wall-clock race, returning
 * only the terminal outcome (scores/findings or failure) — this skill has no
 * per-event SSE forwarding need (unlike the bulk site-crawl), just the
 * finished result. Never throws.
 */
async function auditOnePage(url: string): Promise<PageOutcome> {
  let targetUrl: URL;
  try {
    targetUrl = new URL(url);
  } catch {
    return { scores: null, findings: null, failed: true, errorMessage: "Invalid page URL." };
  }

  const controller = new AbortController();
  let finished = false;
  let capturedScores: ScoreBreakdown | null = null;
  let capturedFindings: AuditFindings | null = null;
  let errorMessage: string | null = null;

  const write = (event: AuditStreamEvent): void => {
    if (finished) return; // drop late events from a run we already gave up on (timeout race lost)
    if (event.type === "scores") {
      capturedScores = event.scores;
      capturedFindings = event.findings;
    }
    if (event.type === "done") finished = true;
    if (event.type === "error") {
      finished = true;
      // A later-stage failure (rewrite generation) after scores already
      // landed doesn't invalidate those scores — only record the message
      // when it's the reason we have no scores at all.
      if (capturedScores === null) errorMessage = event.message;
    }
  };

  const auditPromise = runPageAudit(url, targetUrl, write, {
    fetchTimeoutMs: PAGE_FETCH_TIMEOUT_MS,
    signal: controller.signal,
  }).catch(() => undefined); // runPageAudit is designed never to throw; stay defensive anyway

  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => {
      controller.abort(new Error("page_timeout"));
      resolve();
    }, PAGE_TIMEOUT_MS);
  });

  await Promise.race([auditPromise, timeoutPromise]);
  clearTimeout(timeoutHandle!);

  if (!finished && capturedScores === null) {
    errorMessage = "This page took too long to audit and was skipped.";
  }

  return {
    scores: capturedScores ? toLensScores(capturedScores) : null,
    findings: capturedFindings,
    failed: capturedScores === null,
    errorMessage,
  };
}

function topFindingsFor(outcome: PageOutcome): string[] {
  if (outcome.failed) return [`Audit failed: ${outcome.errorMessage ?? "unknown error"}`];
  return (outcome.findings?.blockers ?? []).slice(0, MAX_TOP_FINDINGS).map((blocker) => blocker.issue);
}

/** Up to `topN` organic entries with distinct domains, dropping the owner's own host. */
function selectCompetitors(
  entries: SerpSkillResult["entries"],
  ownHost: string,
  topN: number,
): SerpSkillResult["entries"] {
  const seenDomains = new Set<string>();
  const selected: SerpSkillResult["entries"] = [];
  for (const entry of entries) {
    if (entry.domain === ownHost) continue;
    if (seenDomains.has(entry.domain)) continue;
    seenDomains.add(entry.domain);
    selected.push(entry);
    if (selected.length >= topN) break;
  }
  return selected;
}

/**
 * The owner's own score for `myUrl`: reuse the latest stored `audit_runs`
 * row's scores when present (cheaper and honest — no silent re-audit of a
 * page the owner already has fresh numbers for), else run one page audit.
 */
async function resolveMineScores(ownerHash: string, myUrl: string): Promise<CompareSkillResult["mine"]> {
  const { data } = await getSupabaseAdmin()
    .from("audit_runs")
    .select("scores")
    .eq("owner_hash", ownerHash)
    .eq("url", myUrl)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const stored = (data as { scores: Record<Lens, number> | null } | null)?.scores;
  if (stored) return { url: myUrl, scores: stored };

  const outcome = await auditOnePage(myUrl);
  return { url: myUrl, scores: outcome.scores };
}

/** Best-effort overwrite of the reserved provider_tasks row with the full
 * assembled result (mirrors runPaidSkill's own completion update). A failed
 * write just means the NEXT identical-fingerprint request recomputes instead
 * of reusing — not a correctness bug for this request's own response. */
async function persistCompareResult(ownerHash: string, taskId: string, task: SkillTask<CompareSkillResult>): Promise<void> {
  await getSupabaseAdmin()
    .from("provider_tasks")
    .update({
      result_meta: { costUsd: task.costUsd, resultVersion: task.resultVersion, result: task.result },
      updated_at: task.updatedAt,
    })
    .eq("owner_hash", ownerHash)
    .eq("id", taskId);
}

export interface RunCompareInput {
  ownerHash: string;
  /** The owning audit_runs.id — provider_tasks.audit_id has an FK to it. */
  ledgerAuditId: string;
  keyword: string;
  /** Clamped to [1, MAX_COMPETITORS]. */
  topN: number;
  myUrl: string;
  /** Called once per competitor as its audit finishes (for the route's SSE progress frames). */
  emitProgress?: (completed: number, total: number) => void;
}

export async function runCompare(input: RunCompareInput): Promise<SkillTask<CompareSkillResult>> {
  const ownHost = hostOf(input.myUrl);
  const keyword = input.keyword.trim();
  const topN = Math.min(Math.max(input.topN, 1), MAX_COMPETITORS);

  const { task: serpTask, reused } = await runPaidSkill({
    ownerHash: input.ownerHash,
    ledgerAuditId: input.ledgerAuditId,
    skillId: "compare",
    scope: { kind: "keyword", keyword },
    fingerprintInput: { keyword: keyword.toLowerCase(), topN },
    estCostUsd: SERP_EST_COST_USD,
    call: () => runSerpLive({ keyword, ownHost }),
  });

  if (serpTask.status !== "complete" || serpTask.result === null) {
    // budget_exceeded / provider_unavailable / fetch_failed — no page audits.
    return serpTask as unknown as SkillTask<CompareSkillResult>; // result is null regardless of TResult
  }
  if (reused) {
    // The stored row already holds a fully-assembled CompareSkillResult from
    // an earlier run with this identical {keyword, topN} fingerprint.
    return { ...serpTask, result: serpTask.result as unknown as CompareSkillResult };
  }

  const competitorEntries = selectCompetitors(serpTask.result.entries, ownHost, topN);
  const total = competitorEntries.length;
  let completed = 0;
  const competitors: CompareSkillResult["competitors"] = new Array(total);

  await runConcurrentQueue(competitorEntries, COMPETITOR_CONCURRENCY, createSiteBudget(COMPARE_BUDGET_MS), async (entry, index) => {
    const outcome = await auditOnePage(entry.url);
    competitors[index] = { rank: entry.rank, url: entry.url, scores: outcome.scores, topFindings: topFindingsFor(outcome) };
    completed += 1;
    input.emitProgress?.(completed, total);
  });

  const mine = await resolveMineScores(input.ownerHash, input.myUrl);
  const result: CompareSkillResult = { keyword, mine, competitors };

  const finalTask: SkillTask<CompareSkillResult> = { ...serpTask, result, updatedAt: new Date().toISOString() };
  await persistCompareResult(input.ownerHash, serpTask.id, finalTask);
  return finalTask;
}
