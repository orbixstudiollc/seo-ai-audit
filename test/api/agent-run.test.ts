import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentEventTypes, collectAgentSse } from "../helpers/sse";
import type { AgentStreamEvent } from "@/lib/skills/types";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rateLimit: vi.fn(),
  ownerHash: vi.fn(),
  fetchArticle: vi.fn(),
  runSchema: vi.fn(),
  runSitemap: vi.fn(),
  runImages: vi.fn(),
  runAiAccess: vi.fn(),
  runHreflang: vi.fn(),
  extractHreflangTags: vi.fn(),
  runPaidSkill: vi.fn(),
  dfsConfigured: vi.fn(),
  startOnPageTask: vi.fn(),
  reserveSpend: vi.fn(),
  cancelSpend: vi.fn(),
  latestTask: vi.fn(),
  reserveTask: vi.fn(),
  attachProviderTask: vi.fn(),
  releaseReservation: vi.fn(),
  taskById: vi.fn(),
}));

vi.mock("@/lib/cloud/server", () => ({
  cloudHistoryConfigured: () => true,
  resolveOwnerHashFromRequest: mocks.ownerHash,
  getSupabaseAdmin: () => ({ from: mocks.from }),
}));

vi.mock("@/lib/audit/ratelimit", () => ({ checkRateLimit: mocks.rateLimit }));

// Keep the real ImportError class (toSkillError/route error classification
// depend on `instanceof`) but control fetchArticle itself.
vi.mock("@/lib/import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/import")>();
  return { ...actual, fetchArticle: mocks.fetchArticle };
});

// Partial mock: businessType.ts also imports extractJsonLdBlocks/flattenJsonLdNodes
// from this module, so a full replacement would break business-type detection.
vi.mock("@/lib/skills/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/schema")>();
  return { ...actual, runSchema: mocks.runSchema };
});
vi.mock("@/lib/skills/sitemap", () => ({ runSitemap: mocks.runSitemap }));
vi.mock("@/lib/skills/images", () => ({ runImages: mocks.runImages }));
vi.mock("@/lib/skills/aiAccess", () => ({ runAiAccess: mocks.runAiAccess }));
vi.mock("@/lib/skills/hreflang", () => ({ runHreflang: mocks.runHreflang, extractHreflangTags: mocks.extractHreflangTags }));
vi.mock("@/lib/skills/paidSkillRunner", () => ({
  runPaidSkill: mocks.runPaidSkill,
  hostOf: (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./i, "");
    } catch {
      return "";
    }
  },
}));
vi.mock("@/lib/dataforseo", () => ({ dataForSeoConfigured: mocks.dfsConfigured, startOnPageTask: mocks.startOnPageTask }));
vi.mock("@/lib/providers/budget", () => ({ reserveSpend: mocks.reserveSpend, cancelSpend: mocks.cancelSpend }));
vi.mock("@/lib/providers/taskStore", () => ({
  latestTask: mocks.latestTask,
  reserveTask: mocks.reserveTask,
  attachProviderTask: mocks.attachProviderTask,
  releaseReservation: mocks.releaseReservation,
  taskById: mocks.taskById,
}));

import { GET, POST } from "@/app/api/audit/agent/route";

const SIMPLE_HTML = "<html><head><title>Example</title></head><body><p>Just a simple page with nothing special about it at all.</p></body></html>";

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

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/audit/agent", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function findEvent<T extends AgentStreamEvent["type"]>(
  events: AgentStreamEvent[],
  type: T,
): Extract<AgentStreamEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<AgentStreamEvent, { type: T }> => e.type === type);
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rateLimit.mockReset();
  mocks.rateLimit.mockReturnValue({ allowed: true, retryAfterSec: 0 });
  mocks.ownerHash.mockReset();
  mocks.ownerHash.mockResolvedValue("owner-hash");
  mocks.fetchArticle.mockReset();
  mocks.runSchema.mockReset();
  mocks.runSitemap.mockReset();
  mocks.runImages.mockReset();
  mocks.runAiAccess.mockReset();
  mocks.runHreflang.mockReset();
  mocks.extractHreflangTags.mockReset();
  mocks.extractHreflangTags.mockReturnValue([]);
  mocks.runPaidSkill.mockReset();
  mocks.dfsConfigured.mockReset();
  mocks.dfsConfigured.mockReturnValue(true);
  mocks.startOnPageTask.mockReset();
  mocks.reserveSpend.mockReset();
  mocks.reserveSpend.mockResolvedValue({ allowed: true });
  mocks.cancelSpend.mockReset();
  mocks.latestTask.mockReset();
  mocks.latestTask.mockResolvedValue({ row: null, error: null });
  mocks.reserveTask.mockReset();
  mocks.attachProviderTask.mockReset();
  mocks.releaseReservation.mockReset();
  mocks.taskById.mockReset();
  delete process.env.AGENT_MAX_SKILLS;
  delete process.env.AGENT_MAX_RUN_USD;
  delete process.env.AGENT_WALL_CLOCK_MS;
});

describe("POST /api/audit/agent — planOnly", () => {
  it("emits plan then done with zero DB writes and zero skill calls", async () => {
    mocks.fetchArticle.mockResolvedValue({ title: "Example", html: SIMPLE_HTML, finalUrl: "https://example.com/" });
    const agentRuns = chain({ data: null, error: null });
    mocks.from.mockImplementation((table: string) => (table === "audit_runs" ? chain({ data: [], error: null }) : agentRuns));

    const res = await POST(postRequest({ url: "https://example.com/", planOnly: true }));
    expect(res.status).toBe(200);
    const events = await collectAgentSse(res);

    expect(agentEventTypes(events)).toEqual(["agent:plan", "agent:done"]);
    const plan = findEvent(events, "agent:plan");
    expect(plan?.businessType).toBe("general");
    // No prior audit for this host -> paid/handoff items are excluded.
    expect(plan?.skills.every((s) => s.estCostUsd === 0)).toBe(true);

    expect(agentRuns.insert).not.toHaveBeenCalled();
    expect(mocks.runSchema).not.toHaveBeenCalled();
    expect(mocks.runPaidSkill).not.toHaveBeenCalled();
  });
});

describe("POST /api/audit/agent — full run", () => {
  it("streams agent:plan first, runs free+paid skills inline, hands off technical-crawl, and always ends agent:rollup -> agent:done", async () => {
    mocks.fetchArticle.mockResolvedValue({ title: "Example", html: SIMPLE_HTML, finalUrl: "https://example.com/" });
    const agentRuns = chain({ data: null, error: null });
    const auditRuns = chain({ data: [{ id: "audit-1", url: "https://example.com/old-page" }], error: null });
    mocks.from.mockImplementation((table: string) => (table === "audit_runs" ? auditRuns : agentRuns));

    mocks.runSchema.mockResolvedValue({ detected: [], missingRecommended: ["Organization"], generated: [] });
    mocks.runSitemap.mockResolvedValue({ sitemapUrl: "https://example.com/sitemap.xml", declaredInRobots: true, urlCount: 1, sameOriginCount: 1, issues: [] });
    mocks.runImages.mockResolvedValue({ imageCount: 0, missingAlt: [], oversized: [], issues: [] });
    mocks.runAiAccess.mockResolvedValue({ crawlers: [], llmsTxt: { present: true, hasSections: true, bytes: 10 } });
    const PAID_RESULTS: Record<string, unknown> = {
      labs: { rows: [] },
      backlinks: { totalBacklinks: 0, referringDomains: 0, rank: null, brokenBacklinks: 0, referringDomainsNofollow: 0 },
    };
    mocks.runPaidSkill.mockImplementation(async ({ skillId, scope }: { skillId: string; scope: unknown }) => ({
      task: { id: `${skillId}-task`, skillId, scope, status: "complete", createdAt: "t", updatedAt: "t", costUsd: 0.03, resultVersion: 1, result: PAID_RESULTS[skillId] ?? {} },
      reused: false,
    }));
    mocks.reserveTask.mockResolvedValue({
      row: { id: "res-1", audit_id: "audit-1", provider_task_id: null, status: "creating", request: {}, result_meta: {}, created_at: "t", updated_at: "t" },
      error: null,
    });
    mocks.startOnPageTask.mockResolvedValue({ taskId: "provider-task-1", costUsd: 0.05 });
    mocks.attachProviderTask.mockResolvedValue({
      row: { id: "tech-task-1", audit_id: "audit-1", provider_task_id: "provider-task-1", status: "queued", request: {}, result_meta: {}, created_at: "t", updated_at: "t" },
      error: null,
    });

    const res = await POST(postRequest({ url: "https://example.com/" }));
    expect(res.status).toBe(200);
    const events = await collectAgentSse(res);
    const types = agentEventTypes(events);

    expect(types[0]).toBe("agent:plan");
    expect(types.at(-1)).toBe("agent:done");
    expect(types.filter((t) => t === "agent:rollup")).toHaveLength(1);
    expect(types.indexOf("agent:rollup")).toBe(types.length - 2);
    expect(types).toContain("agent:skill-handoff");

    const handoff = findEvent(events, "agent:skill-handoff");
    expect(handoff?.skillId).toBe("technical-crawl");
    expect(handoff?.taskId).toBe("tech-task-1");

    const labsDone = events.find((e) => e.type === "agent:skill-done" && e.skillId === "labs");
    expect(labsDone).toMatchObject({ task: { status: "complete", costUsd: 0.03 } });

    const rollup = findEvent(events, "agent:rollup");
    expect(rollup?.pendingTaskIds).toEqual(["tech-task-1"]);
    expect(rollup?.actionPlan.items.some((item) => item.id === "schema-missing-organization")).toBe(true);

    // Incremental persistence: at least one update happened per completed skill.
    expect(agentRuns.insert).toHaveBeenCalledTimes(1);
    expect((agentRuns.update as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
  });
});

describe("POST /api/audit/agent — skill failure", () => {
  it("records a failed task when a skill module throws, and still emits the rollup", async () => {
    mocks.fetchArticle.mockResolvedValue({ title: "Example", html: SIMPLE_HTML, finalUrl: "https://example.com/" });
    mocks.from.mockImplementation((table: string) => (table === "audit_runs" ? chain({ data: [], error: null }) : chain({ data: null, error: null })));

    mocks.runSchema.mockRejectedValue(new Error("boom"));
    mocks.runSitemap.mockResolvedValue({ sitemapUrl: null, declaredInRobots: false, urlCount: 0, sameOriginCount: 0, issues: [] });
    mocks.runImages.mockResolvedValue({ imageCount: 0, missingAlt: [], oversized: [], issues: [] });
    mocks.runAiAccess.mockResolvedValue({ crawlers: [], llmsTxt: { present: true, hasSections: true, bytes: 1 } });

    const res = await POST(postRequest({ url: "https://example.com/" }));
    const events = await collectAgentSse(res);

    const schemaDone = events.find((e) => e.type === "agent:skill-done" && e.skillId === "schema");
    expect(schemaDone).toMatchObject({ task: { status: "failed", error: { kind: "server" } } });

    expect(agentEventTypes(events).at(-1)).toBe("agent:done");
    expect(events.some((e) => e.type === "agent:rollup")).toBe(true);
    // The other free skills still ran despite schema's failure.
    expect(mocks.runSitemap).toHaveBeenCalled();
    expect(mocks.runImages).toHaveBeenCalled();
    expect(mocks.runAiAccess).toHaveBeenCalled();
  });
});

describe("POST /api/audit/agent — wall-clock budget", () => {
  it("marks remaining inline skills as skipped once AGENT_WALL_CLOCK_MS is exhausted, and still emits the rollup", async () => {
    process.env.AGENT_WALL_CLOCK_MS = "0";
    mocks.fetchArticle.mockResolvedValue({ title: "Example", html: SIMPLE_HTML, finalUrl: "https://example.com/" });
    const agentRuns = chain({ data: null, error: null });
    mocks.from.mockImplementation((table: string) => (table === "audit_runs" ? chain({ data: [], error: null }) : agentRuns));

    const res = await POST(postRequest({ url: "https://example.com/" }));
    const events = await collectAgentSse(res);

    expect(events.some((e) => e.type === "agent:skill-start")).toBe(false);
    expect(mocks.runSchema).not.toHaveBeenCalled();
    expect(agentEventTypes(events).at(-1)).toBe("agent:done");
    expect(events.some((e) => e.type === "agent:rollup")).toBe(true);

    // Skipped skills must still reach the client as terminal skill-done
    // events (failed tasks) — otherwise their rows strand as "Queued"
    // forever in the live stream AND every saved snapshot of it.
    const skillDones = events.filter((e): e is Extract<typeof e, { type: "agent:skill-done" }> => e.type === "agent:skill-done");
    expect(skillDones.length).toBeGreaterThan(0);
    for (const done of skillDones) {
      expect(done.task.status).toBe("failed");
      expect(done.task.error?.message).toContain("Skipped");
    }

    const skipUpdate = (agentRuns.update as ReturnType<typeof vi.fn>).mock.calls.find((call: unknown[]) => {
      const patch = call[0] as Record<string, unknown>;
      const results = patch.skill_results as Record<string, { status: string; error?: { message: string } }> | undefined;
      return results?.schema?.status === "failed" && (results.schema.error?.message.includes("Skipped") ?? false);
    });
    expect(skipUpdate).toBeDefined();
  });
});

describe("POST /api/audit/agent — caps", () => {
  it("respects AGENT_MAX_RUN_USD=0 as a free-only kill switch", async () => {
    process.env.AGENT_MAX_RUN_USD = "0";
    mocks.fetchArticle.mockResolvedValue({ title: "Example", html: SIMPLE_HTML, finalUrl: "https://example.com/" });
    mocks.from.mockImplementation((table: string) =>
      table === "audit_runs" ? chain({ data: [{ id: "audit-1", url: "https://example.com/" }], error: null }) : chain({ data: null, error: null }),
    );

    const res = await POST(postRequest({ url: "https://example.com/", planOnly: true }));
    const events = await collectAgentSse(res);
    const plan = findEvent(events, "agent:plan");
    expect(plan?.skills.every((s) => s.estCostUsd === 0)).toBe(true);
  });
});

describe("GET /api/audit/agent", () => {
  it("folds a completed pending technical-crawl task into skill_results and rebuilds the rollup", async () => {
    const storedRun = {
      owner_hash: "owner-hash",
      id: "run-1",
      url: "https://example.com/",
      business_type: "general",
      status: "complete",
      plan: [],
      skill_results: {},
      pending_task_ids: ["tech-task-1"],
      action_plan: { items: [], generatedAt: "t" },
      est_cost_usd: 0.1,
      actual_cost_usd: 0,
      created_at: "t",
      updated_at: "t",
    };
    const updatedRun = { ...storedRun, pending_task_ids: [], skill_results: { "technical-crawl": { status: "complete" } } };

    const select = chain({ data: storedRun, error: null });
    const update = chain({ data: updatedRun, error: null });
    let calls = 0;
    mocks.from.mockImplementation(() => (++calls === 1 ? select : update));

    mocks.taskById.mockResolvedValue({
      row: {
        id: "tech-task-1",
        audit_id: "audit-1",
        provider_task_id: "provider-task-1",
        status: "complete",
        request: { target: "example.com", maxCrawlPages: 500 },
        result_meta: {
          costUsd: 0.05,
          result: {
            target: "example.com", crawlProgress: "finished", maxCrawlPages: 500,
            pagesCrawled: 1, pagesInQueue: 0, onpageScore: 80,
            pages: [{ url: "https://example.com/", statusCode: 200, title: "Example", onpageScore: 80, clickDepth: 0, issueKeys: ["no_title"] }],
          },
        },
        created_at: "t",
        updated_at: "t",
      },
      error: null,
    });

    const res = await GET(new Request("http://localhost/api/audit/agent?runId=run-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: typeof updatedRun };
    expect(body.run.pending_task_ids).toEqual([]);

    expect(update.update).toHaveBeenCalledWith(
      expect.objectContaining({
        pending_task_ids: [],
        skill_results: expect.objectContaining({
          "technical-crawl": expect.objectContaining({ status: "complete" }),
        }),
      }),
    );
  });

  it("404s when the run doesn't belong to this owner", async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: null }));
    const res = await GET(new Request("http://localhost/api/audit/agent?runId=missing"));
    expect(res.status).toBe(404);
  });
});
