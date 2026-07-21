import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeSerpResult, runSerpLive } from "./serp";

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

describe("normalizeSerpResult", () => {
  it("keeps only organic entries, flags isOwn, and truncates long titles", () => {
    const result = normalizeSerpResult(
      {
        items: [
          { type: "organic", rank_absolute: 1, url: "https://www.example.com/", title: "A".repeat(400) },
          { type: "organic", rank_absolute: 2, url: "https://other.example/page", title: "Other" },
          { type: "featured_snippet", rank_absolute: 0, url: "https://featured.example/", title: "Featured" },
        ],
      },
      "seo audit tool",
      "example.com",
    );
    expect(result.keyword).toBe("seo audit tool");
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ rank: 1, domain: "example.com", isOwn: true });
    expect(result.entries[0].title).toHaveLength(300);
    expect(result.entries[1]).toMatchObject({ domain: "other.example", isOwn: false });
  });

  it("skips organic items with an unparseable url and caps at 20 entries", () => {
    const items = [
      { type: "organic", rank_absolute: 1, url: "not-a-url", title: "Broken" },
      ...Array.from({ length: 25 }, (_, i) => ({
        type: "organic",
        rank_absolute: i + 2,
        url: `https://site${i}.example/`,
        title: `Site ${i}`,
      })),
    ];
    const result = normalizeSerpResult({ items }, "kw", "example.com");
    expect(result.entries).toHaveLength(20);
  });
});

describe("runSerpLive", () => {
  it("posts depth 20 and normalizes the returned result plus actual cost", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(envelope({
      cost: 0.011,
      result: [{ items: [{ type: "organic", rank_absolute: 3, url: "https://example.com/pricing", title: "Pricing" }] }],
    })));
    vi.stubGlobal("fetch", fetchMock);

    const { result, costUsd } = await runSerpLive({ keyword: "pricing tool", ownHost: "example.com" });
    expect(costUsd).toBe(0.011);
    expect(result.entries).toEqual([
      { rank: 3, url: "https://example.com/pricing", title: "Pricing", domain: "example.com", isOwn: true },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://provider.test/v3/serp/google/organic/live/advanced");
    expect(JSON.parse(String(init.body))).toEqual([{
      keyword: "pricing tool",
      depth: 20,
      language_code: "en",
      location_code: 2840,
    }]);
  });

  it("propagates the client's rejection error for a bad request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(envelope({ status_code: 40501 }))));
    await expect(runSerpLive({ keyword: "x", ownHost: "example.com" })).rejects.toThrow("DataForSEO rejected the request.");
  });
});
