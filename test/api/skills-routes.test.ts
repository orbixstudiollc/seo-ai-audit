import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Gate-order + envelope tests shared by all five deterministic skill routes
 * (DATA-CONTRACT §8). Each `run<Skill>` is mocked directly (no real
 * network) so these tests exercise only the route's own plumbing:
 * rate limit -> owner resolve -> body validation -> run -> envelope.
 *
 * The §8 envelope carries a run failure as `{ task: { status: "failed" } }`
 * at HTTP 200 — only gate rejections (rate limit / invalid owner / bad
 * body) use a non-200 status, matching app/api/tracked-sites/route.ts's
 * convention of gate failures short-circuiting before any real work.
 */

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  cloudHistoryConfigured: vi.fn(),
  resolveOwnerHashFromRequest: vi.fn(),
  runSchema: vi.fn(),
  runSitemap: vi.fn(),
  runHreflang: vi.fn(),
  runImages: vi.fn(),
  runAiAccess: vi.fn(),
}));

vi.mock("@/lib/audit/ratelimit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("@/lib/cloud/server", () => ({
  cloudHistoryConfigured: mocks.cloudHistoryConfigured,
  resolveOwnerHashFromRequest: mocks.resolveOwnerHashFromRequest,
}));
vi.mock("@/lib/skills/schema", () => ({ runSchema: mocks.runSchema }));
vi.mock("@/lib/skills/sitemap", () => ({ runSitemap: mocks.runSitemap }));
vi.mock("@/lib/skills/hreflang", () => ({ runHreflang: mocks.runHreflang }));
vi.mock("@/lib/skills/images", () => ({ runImages: mocks.runImages }));
vi.mock("@/lib/skills/aiAccess", () => ({ runAiAccess: mocks.runAiAccess }));

import { ImportError } from "@/lib/import";
import { GET as schemaGet, POST as schemaPost } from "@/app/api/skills/schema/route";
import { GET as sitemapGet, POST as sitemapPost } from "@/app/api/skills/sitemap/route";
import { GET as hreflangGet, POST as hreflangPost } from "@/app/api/skills/hreflang/route";
import { GET as imagesGet, POST as imagesPost } from "@/app/api/skills/images/route";
import { GET as aiAccessGet, POST as aiAccessPost } from "@/app/api/skills/ai-access/route";

interface RouteUnderTest {
  skillId: string;
  POST: (request: Request) => Promise<Response>;
  GET: () => Response;
  run: ReturnType<typeof vi.fn>;
}

const routes: RouteUnderTest[] = [
  { skillId: "schema", POST: schemaPost, GET: schemaGet, run: mocks.runSchema },
  { skillId: "sitemap", POST: sitemapPost, GET: sitemapGet, run: mocks.runSitemap },
  { skillId: "hreflang", POST: hreflangPost, GET: hreflangGet, run: mocks.runHreflang },
  { skillId: "images", POST: imagesPost, GET: imagesGet, run: mocks.runImages },
  { skillId: "ai-access", POST: aiAccessPost, GET: aiAccessGet, run: mocks.runAiAccess },
];

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/skills/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { scope: { kind: "page", url: "https://example.com/" } };

beforeEach(() => {
  mocks.rateLimit.mockReset().mockReturnValue({ allowed: true, retryAfterSec: 0 });
  mocks.cloudHistoryConfigured.mockReset().mockReturnValue(true);
  mocks.resolveOwnerHashFromRequest.mockReset().mockResolvedValue("owner-hash");
  for (const route of routes) route.run.mockReset();
});

describe.each(routes)("$skillId route", ({ skillId, POST, GET, run }) => {
  it("rejects over the per-IP bucket before owner resolution, body parsing, or the run", async () => {
    mocks.rateLimit.mockReturnValue({ allowed: false, retryAfterSec: 42 });
    const response = await POST(postRequest(VALID_BODY));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "rate_limit", retryAfter: 42 });
    expect(mocks.resolveOwnerHashFromRequest).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(mocks.rateLimit).toHaveBeenCalledWith(`skills:${skillId}:ip:min:unknown`, 6, 60);
  });

  it("returns 503 cloud_unavailable when cloud history isn't configured", async () => {
    mocks.cloudHistoryConfigured.mockReturnValue(false);
    const response = await POST(postRequest(VALID_BODY));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "cloud_unavailable" });
    expect(run).not.toHaveBeenCalled();
  });

  it("returns 401 invalid_owner when owner resolution fails", async () => {
    mocks.resolveOwnerHashFromRequest.mockResolvedValue(null);
    const response = await POST(postRequest(VALID_BODY));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_owner" });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects an invalid body with 400 before running the skill", async () => {
    const response = await POST(postRequest({ scope: { kind: "page", url: "ftp://example.com/" } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_scope" });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a missing scope with 400", async () => {
    const response = await POST(postRequest({}));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_scope" });
  });

  it("returns a failed task at HTTP 200 when the run is blocked (invalid_input)", async () => {
    run.mockRejectedValue(new ImportError("blocked", "This URL points to a blocked address."));
    const response = await POST(postRequest(VALID_BODY));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { task: { status: string; error: { kind: string; message: string } } };
    expect(body.task.status).toBe("failed");
    expect(body.task.error).toEqual({ kind: "invalid_input", message: "This URL points to a blocked address." });
  });

  it("returns a failed task at HTTP 200 when the run times out (fetch_failed)", async () => {
    run.mockRejectedValue(new ImportError("timeout", "Fetching this URL took too long."));
    const response = await POST(postRequest(VALID_BODY));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { task: { status: string; error: { kind: string } } };
    expect(body.task.status).toBe("failed");
    expect(body.task.error.kind).toBe("fetch_failed");
  });

  it("returns a complete task at HTTP 200 with the module's result on success", async () => {
    run.mockResolvedValue({ ok: true });
    const response = await POST(postRequest(VALID_BODY));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      task: { status: string; skillId: string; costUsd: number; resultVersion: number; result: unknown; scope: unknown };
    };
    expect(body.task.status).toBe("complete");
    expect(body.task.skillId).toBe(skillId);
    expect(body.task.costUsd).toBe(0);
    expect(body.task.resultVersion).toBe(1);
    expect(body.task.result).toEqual({ ok: true });
    expect(body.task.scope).toEqual(VALID_BODY.scope);
  });

  it("GET always 404s — every free skill is stateless", async () => {
    const response = GET();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "task_not_found" });
  });
});
