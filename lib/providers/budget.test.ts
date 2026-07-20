import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/cloud/server", () => ({
  getSupabaseAdmin: () => ({ rpc: mocks.rpc }),
}));

import { budgetCaps, cancelSpend, reserveSpend } from "./budget";

const spend = {
  ownerHash: "a".repeat(64),
  auditId: "site:example",
  provider: "dataforseo-onpage",
  operation: "on_page_task",
  estCostUsd: 0.1,
};

beforeEach(() => {
  mocks.rpc.mockReset();
});

afterEach(() => {
  delete process.env.PROVIDER_OWNER_DAILY_USD;
  delete process.env.PROVIDER_GLOBAL_DAILY_USD;
});

describe("budgetCaps", () => {
  it("defaults when env vars are unset", () => {
    expect(budgetCaps()).toEqual({ ownerDailyUsd: 1, globalDailyUsd: 10 });
  });

  it("reads finite non-negative env values, including the 0 kill switch", () => {
    process.env.PROVIDER_OWNER_DAILY_USD = "0";
    process.env.PROVIDER_GLOBAL_DAILY_USD = "2.5";
    expect(budgetCaps()).toEqual({ ownerDailyUsd: 0, globalDailyUsd: 2.5 });
  });

  it("falls back to defaults on garbage or negative values", () => {
    process.env.PROVIDER_OWNER_DAILY_USD = "unlimited";
    process.env.PROVIDER_GLOBAL_DAILY_USD = "-4";
    expect(budgetCaps()).toEqual({ ownerDailyUsd: 1, globalDailyUsd: 10 });
  });
});

describe("reserveSpend", () => {
  it("passes caps and spend through to the RPC and maps an allow", async () => {
    mocks.rpc.mockResolvedValue({ data: { allowed: true, reason: null }, error: null });
    const result = await reserveSpend(spend);
    expect(result).toEqual({ allowed: true });
    expect(mocks.rpc).toHaveBeenCalledWith("reserve_spend", {
      p_owner_hash: spend.ownerHash,
      p_audit_id: spend.auditId,
      p_provider: spend.provider,
      p_operation: spend.operation,
      p_est_cost: spend.estCostUsd,
      p_owner_cap: 1,
      p_global_cap: 10,
    });
  });

  it("maps owner and global denials", async () => {
    mocks.rpc.mockResolvedValue({ data: { allowed: false, reason: "global" }, error: null });
    expect(await reserveSpend(spend)).toEqual({ allowed: false, reason: "global" });
    mocks.rpc.mockResolvedValue({ data: { allowed: false, reason: "owner" }, error: null });
    expect(await reserveSpend(spend)).toEqual({ allowed: false, reason: "owner" });
  });

  it("denies closed when the RPC errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await reserveSpend(spend)).toEqual({ allowed: false, reason: "error" });
  });
});

describe("cancelSpend", () => {
  it("calls the cancel RPC with the ledger key", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await cancelSpend({
      ownerHash: spend.ownerHash,
      auditId: spend.auditId,
      provider: spend.provider,
      operation: spend.operation,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("cancel_spend", {
      p_owner_hash: spend.ownerHash,
      p_audit_id: spend.auditId,
      p_provider: spend.provider,
      p_operation: spend.operation,
    });
  });
});
