import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  reserveSpend: vi.fn(),
  cancelSpend: vi.fn(),
}));

vi.mock("@/lib/cloud/server", () => ({
  getSupabaseAdmin: () => ({ from: mocks.from }),
}));

vi.mock("@/lib/providers/budget", () => ({
  reserveSpend: mocks.reserveSpend,
  cancelSpend: mocks.cancelSpend,
}));

import { runPaidSkill, type RunPaidSkillInput } from "./paidSkillRunner";

function chain(result: { data?: unknown; error?: unknown }) {
  const value: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (onFulfilled: (v: { data?: unknown; error?: unknown }) => unknown) => Promise<unknown>;
  } = {} as never;
  for (const method of ["select", "eq", "order", "limit", "insert", "update", "delete", "upsert"]) {
    value[method] = vi.fn(() => value);
  }
  value.maybeSingle = vi.fn(async () => result);
  value.single = vi.fn(async () => result);
  value.then = (onFulfilled) => Promise.resolve(result).then(onFulfilled);
  return value;
}

const scope = { kind: "keyword" as const, keyword: "seo audit" };
const resultPayload = { keyword: "seo audit", capturedAt: "2026-07-21T00:00:00.000Z", entries: [] };

function input(overrides: Partial<RunPaidSkillInput<typeof resultPayload>> = {}): RunPaidSkillInput<typeof resultPayload> {
  return {
    ownerHash: "owner-hash",
    ledgerAuditId: "audit-1",
    skillId: "serp",
    scope,
    fingerprintInput: { keyword: "seo audit" },
    estCostUsd: 0.01,
    call: vi.fn().mockResolvedValue({ result: resultPayload, costUsd: 0.009 }),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.reserveSpend.mockReset();
  mocks.reserveSpend.mockResolvedValue({ allowed: true });
  mocks.cancelSpend.mockReset();
  mocks.cancelSpend.mockResolvedValue(undefined);
});

describe("runPaidSkill", () => {
  it("reuses a stored task for an identical fingerprint without touching budget or the provider", async () => {
    const row = {
      id: "task-1", audit_id: "audit-1", provider_task_id: null, status: "complete",
      request: { scope, skillId: "serp" },
      result_meta: { costUsd: 0.01, resultVersion: 1, result: resultPayload },
      created_at: "t", updated_at: "t",
    };
    mocks.from.mockReturnValue(chain({ data: row, error: null }));
    const call = vi.fn();

    const { task, reused } = await runPaidSkill(input({ call }));
    expect(reused).toBe(true);
    expect(task).toMatchObject({ id: "task-1", skillId: "serp", status: "complete", costUsd: 0.01, result: resultPayload });
    expect(call).not.toHaveBeenCalled();
    expect(mocks.reserveSpend).not.toHaveBeenCalled();
  });

  it("denies with a budget_exceeded failed task before reserving anything, and never calls the provider", async () => {
    mocks.from.mockReturnValue(chain({ data: null, error: null })); // latestTask -> none
    mocks.reserveSpend.mockResolvedValue({ allowed: false, reason: "owner" });
    const call = vi.fn();

    const { task, reused } = await runPaidSkill(input({ call }));
    expect(reused).toBe(false);
    expect(task.status).toBe("failed");
    expect(task.error?.kind).toBe("budget_exceeded");
    expect(call).not.toHaveBeenCalled();
  });

  it("on a unique-index collision, cancels its own spend and reuses the concurrent winner's task", async () => {
    const winnerRow = {
      id: "task-2", audit_id: "audit-1", provider_task_id: null, status: "complete",
      request: { scope, skillId: "serp" },
      result_meta: { costUsd: 0.01, resultVersion: 1, result: resultPayload },
      created_at: "t", updated_at: "t",
    };
    let calls = 0;
    mocks.from.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return chain({ data: null, error: null }); // latestTask (initial) -> none
      if (calls === 2) return chain({ data: null, error: { message: "duplicate key" } }); // reserveTask -> collides
      return chain({ data: winnerRow, error: null }); // latestTask (re-read) -> winner
    });
    const call = vi.fn();

    const { task, reused } = await runPaidSkill(input({ call }));
    expect(reused).toBe(true);
    expect(task.id).toBe("task-2");
    expect(mocks.cancelSpend).toHaveBeenCalledTimes(1);
    expect(call).not.toHaveBeenCalled();
  });

  it("releases the reservation and cancels spend when the provider call throws, without persisting a failed row", async () => {
    const reservedRow = {
      id: "res-1", audit_id: "audit-1", provider_task_id: null, status: "creating",
      request: { scope, skillId: "serp" }, result_meta: {}, created_at: "t", updated_at: "t",
    };
    const del = chain({ data: null, error: null });
    let calls = 0;
    mocks.from.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return chain({ data: null, error: null }); // latestTask -> none
      if (calls === 2) return chain({ data: reservedRow, error: null }); // reserveTask -> success
      return del; // releaseReservation delete
    });
    const call = vi.fn().mockRejectedValue(new Error("DataForSEO request failed."));

    const { task, reused } = await runPaidSkill(input({ call }));
    expect(reused).toBe(false);
    expect(task.status).toBe("failed");
    expect(task.error?.kind).toBe("fetch_failed");
    expect(del.delete).toHaveBeenCalled();
    expect(del.eq).toHaveBeenCalledWith("id", "res-1");
    expect(mocks.cancelSpend).toHaveBeenCalledTimes(1);
  });

  it("completes and settles the actual cost when the provider call succeeds", async () => {
    const reservedRow = {
      id: "res-2", audit_id: "audit-1", provider_task_id: null, status: "creating",
      request: { scope, skillId: "serp" }, result_meta: {}, created_at: "t", updated_at: "t",
    };
    const updateChain = chain({ data: null, error: null });
    const ledgerChain = chain({ data: null, error: null });
    let providerCalls = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === "usage_ledger") return ledgerChain;
      providerCalls += 1;
      if (providerCalls === 1) return chain({ data: null, error: null }); // latestTask
      if (providerCalls === 2) return chain({ data: reservedRow, error: null }); // reserveTask
      return updateChain; // completion update
    });
    const call = vi.fn().mockResolvedValue({ result: resultPayload, costUsd: 0.009 });

    const { task, reused } = await runPaidSkill(input({ call }));
    expect(reused).toBe(false);
    expect(task.status).toBe("complete");
    expect(task.result).toEqual(resultPayload);
    expect(task.costUsd).toBe(0.009);
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({ status: "complete" }));
    expect(ledgerChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ actual_cost_usd: 0.009, provider: "dataforseo-serp" }),
      { onConflict: "owner_hash,audit_id,provider,operation" },
    );
  });
});
