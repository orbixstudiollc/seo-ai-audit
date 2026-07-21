import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeLabsResult, runLabsLive } from "./labs";

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

describe("normalizeLabsResult", () => {
  it("drills into nested keyword_data/ranked_serp_element and defaults missing fields", () => {
    const result = normalizeLabsResult([
      {
        keyword_data: { keyword: "seo audit", keyword_info: { search_volume: 500 } },
        ranked_serp_element: { serp_item: { rank_absolute: 4, url: "https://example.com/audit" } },
      },
      { keyword_data: { keyword: "no serp item" } },
      { keyword_data: {} }, // no keyword -> dropped
    ]);
    expect(result.rows).toEqual([
      { keyword: "seo audit", position: 4, volume: 500, url: "https://example.com/audit" },
      { keyword: "no serp item", position: null, volume: null, url: null },
    ]);
  });

  it("caps rows at 100", () => {
    const items = Array.from({ length: 150 }, (_, i) => ({ keyword_data: { keyword: `kw-${i}` } }));
    expect(normalizeLabsResult(items).rows).toHaveLength(100);
  });
});

describe("runLabsLive", () => {
  it("requests limit 100 for the target domain and normalizes actual cost", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(envelope({
      cost: 0.031,
      result: [{ items: [{ keyword_data: { keyword: "seo audit", keyword_info: { search_volume: 500 } } }] }],
    })));
    vi.stubGlobal("fetch", fetchMock);

    const { result, costUsd } = await runLabsLive({ domain: "example.com" });
    expect(costUsd).toBe(0.031);
    expect(result.rows).toEqual([{ keyword: "seo audit", position: null, volume: 500, url: null }]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://provider.test/v3/dataforseo_labs/google/ranked_keywords/live");
    expect(JSON.parse(String(init.body))).toEqual([{
      target: "example.com",
      language_code: "en",
      location_code: 2840,
      limit: 100,
    }]);
  });
});
