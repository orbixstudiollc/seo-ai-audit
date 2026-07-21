import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeBacklinksResult, runBacklinksLive } from "./backlinks";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function envelope(task: Record<string, unknown>): Record<string, unknown> {
  return { status_code: 20000, tasks: [{ status_code: 20000, ...task }] };
}

beforeEach(() => {
  process.env.DATAFORSEO_LOGIN = "api-login";
  process.env.DATAFORSEO_PASSWORD = "api-password";
  process.env.DATAFORSEO_BASE_URL = "https://provider.test";
});

afterEach(() => {
  delete process.env.DATAFORSEO_LOGIN;
  delete process.env.DATAFORSEO_PASSWORD;
  delete process.env.DATAFORSEO_BASE_URL;
  vi.unstubAllGlobals();
});

describe("normalizeBacklinksResult", () => {
  it("maps the summary object and defaults missing numbers", () => {
    expect(normalizeBacklinksResult({
      backlinks: 5000,
      referring_domains: 120,
      rank: 45,
      broken_backlinks: 3,
      referring_domains_nofollow: 20,
    })).toEqual({
      totalBacklinks: 5000,
      referringDomains: 120,
      rank: 45,
      brokenBacklinks: 3,
      referringDomainsNofollow: 20,
    });
    expect(normalizeBacklinksResult({})).toEqual({
      totalBacklinks: 0,
      referringDomains: 0,
      rank: null,
      brokenBacklinks: 0,
      referringDomainsNofollow: 0,
    });
  });
});

describe("runBacklinksLive", () => {
  it("requests the target domain and normalizes actual cost", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(envelope({
      cost: 0.028,
      result: [{ backlinks: 100, referring_domains: 10, rank: 20, broken_backlinks: 1, referring_domains_nofollow: 4 }],
    })));
    vi.stubGlobal("fetch", fetchMock);

    const { result, costUsd } = await runBacklinksLive({ domain: "example.com" });
    expect(costUsd).toBe(0.028);
    expect(result).toEqual({
      totalBacklinks: 100,
      referringDomains: 10,
      rank: 20,
      brokenBacklinks: 1,
      referringDomainsNofollow: 4,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://provider.test/v3/backlinks/summary/live");
    expect(JSON.parse(String(init.body))).toEqual([{ target: "example.com" }]);
  });
});
