import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser: mocks.getUser } }),
}));

import { resolveOwnerHashFromRequest } from "./server";

const ownerToken = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "server-secret";
  mocks.getUser.mockReset();
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
});

describe("cloud owner resolution", () => {
  it("uses the private device owner when no account session is present", async () => {
    const request = new Request("http://localhost", { headers: { "x-seo-audit-owner": ownerToken } });
    await expect(resolveOwnerHashFromRequest(request)).resolves.toBe(createHash("sha256").update(ownerToken).digest("hex"));
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("prefers a cryptographically verified account identity", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-123", email: "owner@example.com" } }, error: null });
    const request = new Request("http://localhost", { headers: { authorization: "Bearer access-token", "x-seo-audit-owner": ownerToken } });
    await expect(resolveOwnerHashFromRequest(request)).resolves.toBe(createHash("sha256").update("account:user-123").digest("hex"));
    expect(mocks.getUser).toHaveBeenCalledWith("access-token");
  });

  it("falls back to the anonymous workspace for an expired account token", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("expired") });
    const request = new Request("http://localhost", { headers: { authorization: "Bearer expired-token", "x-seo-audit-owner": ownerToken } });
    await expect(resolveOwnerHashFromRequest(request)).resolves.toBe(createHash("sha256").update(ownerToken).digest("hex"));
  });
});
