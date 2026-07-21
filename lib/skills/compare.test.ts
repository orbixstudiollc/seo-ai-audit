import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Lens, ScoreBreakdown } from "@aeo/scoring";
import type { AuditStreamEvent } from "@/lib/audit/types";
import type { SerpSkillResult } from "./types";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  reserveSpend: vi.fn(),
  cancelSpend: vi.fn(),
  runSerpLive: vi.fn(),
  runPageAudit: vi.fn(),
}));

vi.mock("@/lib/cloud/server", () => ({ getSupabaseAdmin: () => ({ from: mocks.from }) }));
vi.mock("@/lib/providers/budget", () => ({ reserveSpend: mocks.reserveSpend, cancelSpend: mocks.cancelSpend }));
vi.mock("@/lib/dataforseo/serp", () => ({ SERP_EST_COST_USD: 0.01, runSerpLive: mocks.runSerpLive }));
vi.mock("@/lib/audit/pageAudit", () => ({ runPageAudit: mocks.runPageAudit }));

import { runCompare } from "./compare";

// --- fixtures ----------------------------------------------------------------

type ChainResult = { data?: unknown; error?: unknown };

function chain(result: ChainResult) {
  const value: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (onFulfilled: (v: ChainResult) => unknown) => Promise<unknown>;
  } = {} as never;
  for (const method of ["select", "eq", "order", "limit", "insert", "update", "delete", "upsert"]) {
    value[method] = vi.fn(() => value);
  }
  value.maybeSingle = vi.fn(async () => result);
  value.single = vi.fn(async () => result);
  value.then = (onFulfilled) => Promise.resolve(result).then(onFulfilled);
  return value;
}

function reservedRow(id: string) {
  return { id, audit_id: "audit-1", provider_task_id: null, status: "creating", request: { skillId: "compare" }, result_meta: {}, created_at: "t", updated_at: "t" };
}

/** Wires supabase so runPaidSkill reserves a fresh row (no reuse) and every
 * write succeeds; "audit_runs" (mine's stored-scores lookup) returns
 * `mineRow`, everything else (usage_ledger, provider_tasks updates) no-ops. */
function setupFreshRun(mineRow: ChainResult = { data: null, error: null }): void {
  const none = chain({ data: null, error: null });
  const reserved = chain({ data: reservedRow("task-1"), error: null });
  const update = chain({ data: null, error: null });
  const ledger = chain({ data: null, error: null });
  const audit = chain(mineRow);
  let providerTaskCalls = 0;
  mocks.from.mockImplementation((table: string) => {
    if (table === "usage_ledger") return ledger;
    if (table === "audit_runs") return audit;
    providerTaskCalls += 1;
    if (providerTaskCalls === 1) return none; // latestTask
    if (providerTaskCalls === 2) return reserved; // reserveTask
    return update; // complete-settle (runPaidSkill) + persistCompareResult (compare.ts)
  });
}

function fakeScoreBreakdown(scores: Record<Lens, number>): ScoreBreakdown {
  const lenses = Object.fromEntries(
    (Object.keys(scores) as Lens[]).map((lens) => [lens, { lens, score: scores[lens], capped: false }]),
  ) as ScoreBreakdown["lenses"];
  return { lenses, signals: {}, rubricVersion: "v1", signalsVersion: "v1", modelId: "test" } as ScoreBreakdown;
}

const SAMPLE_SCORES: Record<Lens, number> = { aeo: 70, geo: 60, citability: 55, aiOverview: 50 };

/** A successful page audit: emits scores + findings, then done. */
function successfulPageAudit(blockers: { issue: string; location: string }[] = []) {
  return async (_url: string, _target: URL, write: (e: AuditStreamEvent) => void) => {
    write({
      type: "scores",
      scores: fakeScoreBreakdown(SAMPLE_SCORES),
      findings: { questionGaps: [], anchorSuggestions: [], blockers, qaPairs: [], quotables: [] },
    });
    write({ type: "done" });
  };
}

/** A page audit that fails outright (no scores event, terminal error). */
function failingPageAudit(message = "fetch failed") {
  return async (_url: string, _target: URL, write: (e: AuditStreamEvent) => void) => {
    write({ type: "error", kind: "fetch_failed", message });
  };
}

function serpEntries(overrides: Partial<SerpSkillResult["entries"][number]>[]): SerpSkillResult["entries"] {
  return overrides.map((o, i) => ({
    rank: i + 1,
    url: `https://example.test/${i}`,
    title: `Result ${i}`,
    domain: `example${i}.test`,
    isOwn: false,
    ...o,
  }));
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.reserveSpend.mockReset();
  mocks.reserveSpend.mockResolvedValue({ allowed: true });
  mocks.cancelSpend.mockReset();
  mocks.runSerpLive.mockReset();
  mocks.runPageAudit.mockReset();
});

describe("runCompare — distinct-domain selection", () => {
  it("drops the owner's own host and de-duplicates repeat domains, keeping SERP rank order", async () => {
    setupFreshRun();
    const entries = serpEntries([
      { rank: 1, url: "https://mine.test/page", domain: "mine.test", isOwn: true },
      { rank: 2, url: "https://a.test/1", domain: "a.test" },
      { rank: 3, url: "https://a.test/2", domain: "a.test" }, // duplicate domain, dropped
      { rank: 4, url: "https://b.test/1", domain: "b.test" },
      { rank: 5, url: "https://c.test/1", domain: "c.test" },
    ]);
    mocks.runSerpLive.mockResolvedValue({
      result: { keyword: "oat milk", capturedAt: "t", entries } satisfies SerpSkillResult,
      costUsd: 0.009,
    });
    mocks.runPageAudit.mockImplementation(successfulPageAudit());

    const task = await runCompare({
      ownerHash: "owner-1",
      ledgerAuditId: "audit-1",
      keyword: "oat milk",
      topN: 3,
      myUrl: "https://mine.test/",
    });

    expect(task.status).toBe("complete");
    const result = task.result!;
    expect(result.competitors.map((c) => c.url)).toEqual(["https://a.test/1", "https://b.test/1", "https://c.test/1"]);
    expect(result.competitors.map((c) => c.rank)).toEqual([2, 4, 5]);
  });
});

describe("runCompare — topN bounding", () => {
  it("clamps topN above MAX_COMPETITORS (3) down to 3 distinct competitors", async () => {
    setupFreshRun();
    const entries = serpEntries([
      { rank: 1, domain: "a.test", url: "https://a.test" },
      { rank: 2, domain: "b.test", url: "https://b.test" },
      { rank: 3, domain: "c.test", url: "https://c.test" },
      { rank: 4, domain: "d.test", url: "https://d.test" },
    ]);
    mocks.runSerpLive.mockResolvedValue({ result: { keyword: "kw", capturedAt: "t", entries }, costUsd: 0.01 });
    mocks.runPageAudit.mockImplementation(successfulPageAudit());

    const task = await runCompare({
      ownerHash: "owner-1",
      ledgerAuditId: "audit-1",
      keyword: "kw",
      topN: 10,
      myUrl: "https://mine.test/",
    });

    expect(task.result!.competitors).toHaveLength(3);
  });
});

describe("runCompare — failed-audit degradation", () => {
  it("degrades a failed competitor audit to scores: null + an 'Audit failed' finding, without aborting the run", async () => {
    setupFreshRun();
    const entries = serpEntries([
      { rank: 1, domain: "a.test", url: "https://a.test" },
      { rank: 2, domain: "b.test", url: "https://b.test" },
    ]);
    mocks.runSerpLive.mockResolvedValue({ result: { keyword: "kw", capturedAt: "t", entries }, costUsd: 0.01 });
    mocks.runPageAudit.mockImplementation(async (url: string, target: URL, write: (e: AuditStreamEvent) => void) => {
      if (url === "https://a.test") return failingPageAudit("timed out")(url, target, write);
      return successfulPageAudit()(url, target, write);
    });

    const task = await runCompare({
      ownerHash: "owner-1",
      ledgerAuditId: "audit-1",
      keyword: "kw",
      topN: 2,
      myUrl: "https://mine.test/",
    });

    expect(task.status).toBe("complete");
    const [failed, ok] = task.result!.competitors;
    expect(failed.scores).toBeNull();
    expect(failed.topFindings).toEqual(["Audit failed: timed out"]);
    expect(ok.scores).toEqual(SAMPLE_SCORES);
  });

  it("keeps a competitor's real scores even when a later stage (rewrite generation) errors after scores landed", async () => {
    setupFreshRun();
    const entries = serpEntries([{ rank: 1, domain: "a.test", url: "https://a.test" }]);
    mocks.runSerpLive.mockResolvedValue({ result: { keyword: "kw", capturedAt: "t", entries }, costUsd: 0.01 });
    mocks.runPageAudit.mockImplementation(async (_url: string, _target: URL, write: (e: AuditStreamEvent) => void) => {
      write({ type: "scores", scores: fakeScoreBreakdown(SAMPLE_SCORES), findings: { questionGaps: [], anchorSuggestions: [], blockers: [], qaPairs: [], quotables: [] } });
      write({ type: "error", kind: "server", message: "rewrite generation failed" }); // pageAudit.ts's own failure mode after scores
    });

    const task = await runCompare({
      ownerHash: "owner-1",
      ledgerAuditId: "audit-1",
      keyword: "kw",
      topN: 1,
      myUrl: "https://mine.test/",
    });

    expect(task.result!.competitors[0].scores).toEqual(SAMPLE_SCORES);
    expect(task.result!.competitors[0].topFindings).toEqual([]);
  });
});

describe("runCompare — topFindings capped", () => {
  it("caps a competitor's topFindings at 3 blockers", async () => {
    setupFreshRun();
    const entries = serpEntries([{ rank: 1, domain: "a.test", url: "https://a.test" }]);
    mocks.runSerpLive.mockResolvedValue({ result: { keyword: "kw", capturedAt: "t", entries }, costUsd: 0.01 });
    const blockers = [
      { issue: "No first-sentence answer", location: "intro" },
      { issue: "No citations", location: "body" },
      { issue: "No structured data", location: "head" },
      { issue: "Thin content", location: "body" },
    ];
    mocks.runPageAudit.mockImplementation(successfulPageAudit(blockers));

    const task = await runCompare({
      ownerHash: "owner-1",
      ledgerAuditId: "audit-1",
      keyword: "kw",
      topN: 1,
      myUrl: "https://mine.test/",
    });

    expect(task.result!.competitors[0].topFindings).toEqual([
      "No first-sentence answer",
      "No citations",
      "No structured data",
    ]);
  });
});

describe("runCompare — mine scores", () => {
  it("reuses the owner's latest stored audit_runs scores instead of re-auditing", async () => {
    setupFreshRun({ data: { scores: SAMPLE_SCORES }, error: null });
    mocks.runSerpLive.mockResolvedValue({ result: { keyword: "kw", capturedAt: "t", entries: [] }, costUsd: 0.01 });

    const task = await runCompare({
      ownerHash: "owner-1",
      ledgerAuditId: "audit-1",
      keyword: "kw",
      topN: 3,
      myUrl: "https://mine.test/",
    });

    expect(task.result!.mine).toEqual({ url: "https://mine.test/", scores: SAMPLE_SCORES });
    expect(mocks.runPageAudit).not.toHaveBeenCalled();
  });

  it("runs a fresh page audit for myUrl when no stored scores exist", async () => {
    setupFreshRun({ data: null, error: null });
    mocks.runSerpLive.mockResolvedValue({ result: { keyword: "kw", capturedAt: "t", entries: [] }, costUsd: 0.01 });
    mocks.runPageAudit.mockImplementation(successfulPageAudit());

    const task = await runCompare({
      ownerHash: "owner-1",
      ledgerAuditId: "audit-1",
      keyword: "kw",
      topN: 3,
      myUrl: "https://mine.test/",
    });

    expect(task.result!.mine).toEqual({ url: "https://mine.test/", scores: SAMPLE_SCORES });
    expect(mocks.runPageAudit).toHaveBeenCalledTimes(1);
  });
});

describe("runCompare — budget denied", () => {
  it("returns the failed task with no page audits when the SERP reservation is budget-denied", async () => {
    const none = chain({ data: null, error: null });
    mocks.from.mockReturnValue(none);
    mocks.reserveSpend.mockResolvedValue({ allowed: false, reason: "owner" });

    const task = await runCompare({
      ownerHash: "owner-1",
      ledgerAuditId: "audit-1",
      keyword: "kw",
      topN: 3,
      myUrl: "https://mine.test/",
    });

    expect(task.status).toBe("failed");
    expect(task.error?.kind).toBe("budget_exceeded");
    expect(task.result).toBeNull();
    expect(mocks.runPageAudit).not.toHaveBeenCalled();
    expect(mocks.runSerpLive).not.toHaveBeenCalled();
  });
});

describe("runCompare — reuse", () => {
  it("returns the stored full CompareSkillResult without re-running page audits when the fingerprint matches", async () => {
    const storedResult = {
      keyword: "kw",
      mine: { url: "https://mine.test/", scores: SAMPLE_SCORES },
      competitors: [{ rank: 1, url: "https://a.test", scores: SAMPLE_SCORES, topFindings: [] }],
    };
    const existingRow = {
      id: "task-existing",
      audit_id: "audit-1",
      provider_task_id: null,
      status: "complete",
      request: { skillId: "compare", scope: { kind: "keyword", keyword: "kw" } },
      result_meta: { costUsd: 0.01, resultVersion: 1, result: storedResult },
      created_at: "t",
      updated_at: "t",
    };
    mocks.from.mockReturnValue(chain({ data: existingRow, error: null }));

    const task = await runCompare({
      ownerHash: "owner-1",
      ledgerAuditId: "audit-1",
      keyword: "kw",
      topN: 3,
      myUrl: "https://mine.test/",
    });

    expect(task.status).toBe("complete");
    expect(task.result).toEqual(storedResult);
    expect(mocks.runSerpLive).not.toHaveBeenCalled();
    expect(mocks.runPageAudit).not.toHaveBeenCalled();
  });
});
