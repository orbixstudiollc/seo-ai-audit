import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataForSeoConfigured, pollOnPageTask, startOnPageTask } from "./client";

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

describe("DataForSEO OnPage client", () => {
  it("requires both server-only credentials", () => {
    expect(dataForSeoConfigured()).toBe(true);
    delete process.env.DATAFORSEO_PASSWORD;
    expect(dataForSeoConfigured()).toBe(false);
  });

  it("starts a conservative, cost-bounded task", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(envelope({
      status_code: 20100,
      id: "task-123",
      cost: 0.0125,
      result: null,
    })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(startOnPageTask({ target: "example.com", maxCrawlPages: 500 })).resolves.toEqual({
      taskId: "task-123",
      costUsd: 0.0125,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://provider.test/v3/on_page/task_post");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    expect(JSON.parse(String(init.body))).toEqual([{
      target: "example.com",
      max_crawl_pages: 500,
      respect_sitemap: true,
      crawl_sitemap_only: false,
      load_resources: false,
      enable_javascript: false,
      enable_browser_rendering: false,
    }]);
  });

  it("returns progress without collecting pages before a crawl finishes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(envelope({ result: [{
      target: "example.com",
      crawl_progress: "in_progress",
      crawl_status: { max_crawl_pages: 500, pages_crawled: 31, pages_in_queue: 42 },
      onpage_score: 77.4,
    }] })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await pollOnPageTask("task-123", 500);
    expect(result.status).toBe("running");
    expect(result.result.pagesCrawled).toBe(31);
    expect(result.result.pages).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("collects and normalizes every returned HTML page after completion", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(envelope({ result: [{
        target: "example.com",
        crawl_progress: "finished",
        crawl_status: { max_crawl_pages: 500, pages_crawled: 2, pages_in_queue: 0 },
        onpage_score: 81.2,
      }] })))
      .mockResolvedValueOnce(response(envelope({ result: [{ items: [
        { url: "https://example.com/", status_code: 200, onpage_score: 90, click_depth: 0, meta: { title: "Home" }, checks: { no_title: false, high_loading_time: true } },
        { url: "https://example.com/about", status_code: 200, onpage_score: 72, click_depth: 1, meta: { title: "About" }, checks: { no_description: true } },
      ] }] })));
    vi.stubGlobal("fetch", fetchMock);

    const result = await pollOnPageTask("task-123", 500);
    expect(result.status).toBe("complete");
    expect(result.result.pages).toHaveLength(2);
    expect(result.result.pages[0]).toMatchObject({ title: "Home", issueKeys: ["high_loading_time"] });
    const [, pagesInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(pagesInit.body))[0].limit).toBe(500);
  });

  it("does not expose provider response details in thrown errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ secret: "provider detail" }, 401)));
    await expect(startOnPageTask({ target: "example.com", maxCrawlPages: 1 }))
      .rejects.toThrow("DataForSEO request failed.");
  });
});
