import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeKeywordsResult, runKeywordsLive } from "./keywords";

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

describe("normalizeKeywordsResult", () => {
  it("maps rows and defaults missing metrics to null", () => {
    const result = normalizeKeywordsResult([
      { keyword: "seo audit", search_volume: 1200, cpc: 3.2, competition_index: 45 },
      { keyword: "no metrics" },
      { search_volume: 10 }, // no keyword -> dropped
    ]);
    expect(result.rows).toEqual([
      { keyword: "seo audit", volume: 1200, cpc: 3.2, competition: 45 },
      { keyword: "no metrics", volume: null, cpc: null, competition: null },
    ]);
  });

  it("caps rows at 100", () => {
    const items = Array.from({ length: 150 }, (_, i) => ({ keyword: `kw-${i}`, search_volume: i }));
    expect(normalizeKeywordsResult(items).rows).toHaveLength(100);
  });
});

describe("runKeywordsLive", () => {
  it("sends up to 100 keywords and normalizes the response plus actual cost", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(envelope({
      cost: 0.079,
      result: [{ keyword: "seo audit", search_volume: 900, cpc: 2.1, competition_index: 30 }],
    })));
    vi.stubGlobal("fetch", fetchMock);

    const keywords = Array.from({ length: 120 }, (_, i) => `kw-${i}`);
    const { result, costUsd } = await runKeywordsLive({ keywords });
    expect(costUsd).toBe(0.079);
    expect(result.rows).toEqual([{ keyword: "seo audit", volume: 900, cpc: 2.1, competition: 30 }]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://provider.test/v3/keywords_data/google_ads/search_volume/live");
    const sentBody = JSON.parse(String(init.body))[0];
    expect(sentBody.keywords).toHaveLength(100);
    expect(sentBody.language_code).toBe("en");
    expect(sentBody.location_code).toBe(2840);
  });
});
