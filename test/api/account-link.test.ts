import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  device: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/cloud/server", () => ({
  cloudHistoryConfigured: () => true,
  verifiedAccountFromRequest: mocks.account,
  ownerHashFromRequest: mocks.device,
  getSupabaseAdmin: () => ({ rpc: mocks.rpc }),
}));

import { POST } from "@/app/api/account/link/route";

beforeEach(() => {
  mocks.account.mockReset(); mocks.device.mockReset(); mocks.rpc.mockReset();
  mocks.account.mockResolvedValue({ userId: "user-123", email: "owner@example.com", ownerHash: "user-hash" });
  mocks.device.mockReturnValue("device-hash");
  mocks.rpc.mockResolvedValue({ error: null });
});

describe("POST /api/account/link", () => {
  it("requires a verified Supabase Auth session", async () => {
    mocks.account.mockResolvedValue(null);
    const response = await POST(new Request("http://localhost/api/account/link", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires the current anonymous owner token", async () => {
    mocks.device.mockReturnValue(null);
    const response = await POST(new Request("http://localhost/api/account/link", { method: "POST" }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("atomically claims the device workspace for the verified account", async () => {
    const response = await POST(new Request("http://localhost/api/account/link", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("claim_anonymous_workspace", {
      p_device_hash: "device-hash",
      p_user_hash: "user-hash",
    });
    expect(await response.json()).toEqual({ linked: true, email: "owner@example.com" });
  });
});
