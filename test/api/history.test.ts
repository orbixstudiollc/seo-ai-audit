import { afterEach, describe, expect, it } from "vitest";
import { GET, PUT } from "@/app/api/history/route";
import { GET as GET_SETTINGS, PUT as PUT_SETTINGS } from "@/app/api/settings/route";
import { CLOUD_OWNER_HEADER } from "@/lib/cloud/owner";

const owner = "a".repeat(43);
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalSecret = process.env.SUPABASE_SECRET_KEY;
const originalLegacySecret = process.env.SUPABASE_SERVICE_ROLE_KEY;

function request(path: string, method = "GET", body?: unknown, token = owner): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json", [CLOUD_OWNER_HEADER]: token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

afterEach(() => {
  if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  if (originalSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = originalSecret;
  if (originalLegacySecret === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalLegacySecret;
});

describe("cloud persistence routes", () => {
  it("falls back safely when Supabase is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect((await GET(request("/api/history"))).status).toBe(503);
    expect((await GET_SETTINGS(request("/api/settings"))).status).toBe(503);
  });

  it("rejects malformed ownership tokens before database access", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-secret";
    expect((await GET(request("/api/history", "GET", undefined, "bad"))).status).toBe(401);
    expect((await GET_SETTINGS(request("/api/settings", "GET", undefined, "bad"))).status).toBe(401);
  });

  it("validates history and settings payloads before database access", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "test-secret";
    expect((await PUT(request("/api/history", "PUT", { records: [{ broken: true }] }))).status).toBe(400);
    expect((await PUT_SETTINGS(request("/api/settings", "PUT", { settings: { broken: true } }))).status).toBe(400);
  });
});

