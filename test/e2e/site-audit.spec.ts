import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";

/**
 * The full whole-site journey, end to end: landing form -> "Whole site" mode
 * -> /audit/site?url= -> a real POST /api/audit/bulk -> real SSRF-guarded
 * discovery (sitemap.xml + 2 linked pages, a local fixture HTTP server
 * reached via AUDIT_TEST_ALLOW_LOOPBACK — see playwright.config.ts) ->
 * bounded-concurrency per-page audits (AUDIT_TEST_MOCK=1 for the LLM calls)
 * -> the live-streamed page list + site rollup -> drilling into one page's
 * full report (reusing WS3's AuditReportView). Only the LLM calls are
 * mocked; discovery, fetch, SSRF guard, DET signals, and SSE plumbing are
 * all real.
 */

interface RouteResponse {
  status?: number;
  headers?: Record<string, string>;
  body: string;
}

/** Like test/helpers/testServer.ts, but routes can be set AFTER the server is
 * already listening — sitemap.xml needs to embed the server's own dynamically
 * assigned baseUrl, which isn't known until listen() resolves. */
function createSelfReferencingTestServer(): Promise<{
  baseUrl: string;
  setRoutes(routes: Record<string, RouteResponse>): void;
  close(): Promise<void>;
}> {
  let routes: Record<string, RouteResponse> = {};
  const server: Server = createServer((req, res) => {
    const route = routes[req.url ?? "/"];
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(route.status ?? 200, route.headers ?? { "content-type": "text/html" });
    res.end(route.body);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        setRoutes: (next) => {
          routes = next;
        },
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

function articlePage(title: string): string {
  return `<html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>Real article content about ${title.toLowerCase()} — long enough for Readability to extract a usable page.</p></article></body></html>`;
}

let server: Awaited<ReturnType<typeof createSelfReferencingTestServer>>;

test.beforeAll(async () => {
  server = await createSelfReferencingTestServer();
  const sitemapXml = `<urlset><url><loc>${server.baseUrl}/page-a</loc></url><url><loc>${server.baseUrl}/page-b</loc></url></urlset>`;
  server.setRoutes({
    "/": { body: articlePage("Fixture Home") },
    "/page-a": { body: articlePage("Fixture Page A") },
    "/page-b": { body: articlePage("Fixture Page B") },
    "/sitemap.xml": { headers: { "content-type": "application/xml" }, body: sitemapXml },
  });
});

test.afterAll(async () => {
  await server.close();
});

test("audits a whole site: discovers a 3-page sitemap, streams per-page results, rolls up, and drills into a page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Whole site" }).click();
  await page.getByRole("textbox", { name: "URL to audit" }).fill(`${server.baseUrl}/`);
  await page.getByRole("button", { name: "Audit site" }).click();
  await page.waitForURL(/\/audit\/site\?url=/);

  // Discovery found the sitemap and listed all 3 pages (root + 2 sitemap URLs).
  await expect(page.getByText("Pages (3)")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("via sitemap")).toBeVisible();

  // Every page reaches a terminal "Done" status (mock LLM, so no real spend).
  await expect(page.getByText("Done")).toHaveCount(3, { timeout: 20_000 });

  // The site-level rollup renders once every page has a result.
  await expect(page.getByText("Site rollup")).toBeVisible();
  await expect(page.getByText("Worst pages")).toBeVisible();
  await expect(page.getByText("Common findings")).toBeVisible();

  // No site-level error banner — the whole crawl completed successfully.
  // ("Run again" only renders inside the error banner; Next.js's own
  // route-announcer also has role="alert", so it's not a safe check here —
  // see the same note in test/e2e/live-audit.spec.ts.)
  await expect(page.getByRole("button", { name: "Run again" })).toHaveCount(0);

  // Drill into a finished page: reuses AuditReportView (WS3) verbatim.
  await page
    .getByRole("button", { name: /Fixture Home/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "← Back to site overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fixture Home" })).toBeVisible();
  for (const name of [/Answer Engine score/, /Generative Engine score/, /Citability score/, /AI Overview score/]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }
  await expect(page.getByText("Answer-first intro", { exact: true })).toBeVisible();

  // Back to the overview keeps the same completed run in place.
  await page.getByRole("button", { name: "← Back to site overview" }).click();
  await expect(page.getByText("Site rollup")).toBeVisible();

  // One site-level history item is saved (not one item per crawled page).
  await expect(page.getByText("Saved to your dashboard on this browser.")).toBeVisible();
  await page.getByRole("link", { name: "View dashboard" }).click();
  await expect(page.getByText("History (1)", { exact: true })).toBeVisible();
  await expect(page.getByText(/· 3 pages$/)).toBeVisible();
  let technicalStarted = false;
  await page.route("/api/technical-audit**", async (route) => {
    const request = route.request();
    const now = "2026-07-20T00:00:00.000Z";
    const task = {
      auditId: "site:fixture",
      providerTaskId: "provider-task",
      status: technicalStarted ? "complete" : "queued",
      costUsd: 0.0125,
      createdAt: now,
      updatedAt: now,
      errorMessage: null,
      result: technicalStarted ? {
        target: "example.test", crawlProgress: "finished", maxCrawlPages: 500,
        pagesCrawled: 26, pagesInQueue: 0, onpageScore: 82,
        pages: Array.from({ length: 26 }, (_, index) => ({
          url: `https://example.test/page-${index + 1}`, statusCode: 200,
          title: `Technical page ${index + 1}`, onpageScore: 90 - index,
          clickDepth: index, issueKeys: index === 0 ? ["high_loading_time"] : [],
        })),
      } : null,
    };
    if (request.method() === "POST") {
      expect((await request.postDataJSON()).limit).toBe(500);
      technicalStarted = true;
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ task: { ...task, status: "queued", result: null }, reused: false }) });
      return;
    }
    if (!technicalStarted) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "task_not_found", configured: true }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ task }) });
  });
  await page.getByRole("link", { name: "Open report" }).click();
  await expect(page.getByText(/Saved report/)).toBeVisible();
  await expect(page.getByText("Site rollup")).toBeVisible();
  await expect(page.getByText("Technical SEO", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run technical crawl" }).click();
  await expect(page.getByText("Pages crawled", { exact: true })).toBeVisible();
  await expect(page.getByText("Page 1 of 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Technical page 26", { exact: true })).toBeVisible();
});

test("retries one failed bulk page without rerunning the whole site", async ({ page }) => {
  const failedUrl = `${server.baseUrl}/page-a`;
  const events = [
    { type: "site:discovery-start", rootUrl: `${server.baseUrl}/` },
    { type: "site:discovery-done", rootUrl: `${server.baseUrl}/`, method: "sitemap", pages: [{ url: failedUrl, source: "sitemap" }], truncated: false },
    { type: "site:page-start", url: failedUrl, index: 0, total: 1 },
    { type: "site:page-event", url: failedUrl, index: 0, event: { type: "error", kind: "server", message: "Fixture provider failure." } },
    { type: "site:page-done", url: failedUrl, index: 0, status: "error" },
    { type: "site:rollup", rollup: { pagesAudited: 0, pagesFailed: 1, avgScores: null, worstPages: [], commonFindings: [] }, stoppedEarly: null },
    { type: "site:done" },
  ];
  await page.route("/api/audit/bulk", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
  });
  await page.goto(`/audit/site?url=${encodeURIComponent(`${server.baseUrl}/`)}`);
  const retryPage = page.getByRole("link", { name: "Retry page", exact: true });
  await expect(retryPage).toBeVisible();
  await retryPage.click();
  await expect(page).toHaveURL(/\/audit\?url=/);
  await expect(page.getByRole("heading", { name: "Fixture Page A" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Answer-first intro", { exact: true })).toBeVisible();
});

test("retries every failed page in one click without rerunning successful pages", async ({ page }) => {
  const rootUrl = `${server.baseUrl}/`;
  const goodUrl = `${server.baseUrl}/page-a`;
  const failedUrls = [`${server.baseUrl}/page-b`, `${server.baseUrl}/missing`];
  const discovered = [goodUrl, ...failedUrls].map((url) => ({ url, source: "sitemap" }));
  const initialEvents = [
    { type: "site:discovery-start", rootUrl },
    { type: "site:discovery-done", rootUrl, method: "sitemap", pages: discovered, truncated: false },
    { type: "site:page-start", url: goodUrl, index: 0, total: 3 },
    { type: "site:page-event", url: goodUrl, index: 0, event: { type: "done" } },
    { type: "site:page-done", url: goodUrl, index: 0, status: "ok" },
    ...failedUrls.flatMap((url, offset) => [
      { type: "site:page-start", url, index: offset + 1, total: 3 },
      { type: "site:page-event", url, index: offset + 1, event: { type: "error", kind: "server", message: "Fixture failure." } },
      { type: "site:page-done", url, index: offset + 1, status: "error" },
    ]),
    { type: "site:rollup", rollup: { pagesAudited: 1, pagesFailed: 2, avgScores: null, worstPages: [], commonFindings: [] }, stoppedEarly: null },
    { type: "site:done" },
  ];
  const retryEvents = [
    { type: "site:discovery-start", rootUrl },
    { type: "site:discovery-done", rootUrl, method: "retry", pages: failedUrls.map((url) => ({ url, source: "retry" })), truncated: false },
    ...failedUrls.flatMap((url, index) => [
      { type: "site:page-start", url, index, total: 2 },
      { type: "site:page-event", url, index, event: { type: "done" } },
      { type: "site:page-done", url, index, status: "ok" },
    ]),
    { type: "site:rollup", rollup: { pagesAudited: 2, pagesFailed: 0, avgScores: null, worstPages: [], commonFindings: [] }, stoppedEarly: null },
    { type: "site:done" },
  ];
  const requests: Array<{ url: string; pages?: string[] }> = [];

  await page.route("/api/audit/bulk", async (route) => {
    const body = await route.request().postDataJSON() as { url: string; pages?: string[] };
    requests.push(body);
    const events = body.pages ? retryEvents : initialEvents;
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
  });

  await page.goto(`/audit/site?url=${encodeURIComponent(rootUrl)}`);
  const retryFailed = page.getByRole("button", { name: "Retry 2 failed pages", exact: true });
  await expect(retryFailed).toBeVisible();
  await retryFailed.click();

  await expect(page.getByText("Done")).toHaveCount(3);
  await expect(retryFailed).toHaveCount(0);
  expect(requests).toHaveLength(2);
  expect(requests[1]?.pages).toEqual(failedUrls);
  expect(requests[1]?.pages).not.toContain(goodUrl);
});

test("retries failed pages from a reopened report and persists the merged report", async ({ page }) => {
  const rootUrl = `${server.baseUrl}/`;
  const goodUrl = `${server.baseUrl}/page-a`;
  const failedUrl = `${server.baseUrl}/page-b`;
  const id = `site:${rootUrl}:saved-retry`;

  await page.goto("/");
  await page.evaluate(async ({ id, rootUrl, goodUrl, failedUrl }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("seo-ai-audit:reports", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("reports", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("reports", "readwrite");
      transaction.objectStore("reports").put({
        version: 1,
        id,
        kind: "site",
        createdAt: "2026-07-20T00:00:00.000Z",
        phase: "done",
        state: {
          rootUrl,
          method: "sitemap",
          discoveredPages: [{ url: goodUrl, source: "sitemap" }, { url: failedUrl, source: "sitemap" }],
          truncated: false,
          pages: {
            [goodUrl]: { phase: "done", url: goodUrl, index: 0, page: null, signals: null, scores: null, findings: null, rewrites: null, error: null },
            [failedUrl]: { phase: "error", url: failedUrl, index: 1, page: null, signals: null, scores: null, findings: null, rewrites: null, error: { kind: "server", message: "Fixture failure." } },
          },
          pageOrder: [goodUrl, failedUrl],
          rollup: { pagesAudited: 1, pagesFailed: 1, avgScores: null, worstPages: [], commonFindings: [] },
          stoppedEarly: null,
          error: null,
        },
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, { id, rootUrl, goodUrl, failedUrl });

  let retryBody: { url: string; pages?: string[] } | null = null;
  await page.route("/api/audit/bulk", async (route) => {
    retryBody = await route.request().postDataJSON() as { url: string; pages?: string[] };
    const events = [
      { type: "site:discovery-start", rootUrl },
      { type: "site:discovery-done", rootUrl, method: "retry", pages: [{ url: failedUrl, source: "retry" }], truncated: false },
      { type: "site:page-start", url: failedUrl, index: 0, total: 1 },
      { type: "site:page-event", url: failedUrl, index: 0, event: { type: "done" } },
      { type: "site:page-done", url: failedUrl, index: 0, status: "ok" },
      { type: "site:rollup", rollup: { pagesAudited: 1, pagesFailed: 0, avgScores: null, worstPages: [], commonFindings: [] }, stoppedEarly: null },
      { type: "site:done" },
    ];
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") });
  });

  await page.goto(`/report/${encodeURIComponent(id)}`);
  await page.getByRole("button", { name: "Retry 1 failed page", exact: true }).click();
  await expect(page.getByText("Done")).toHaveCount(2);
  expect(retryBody).toEqual({ url: rootUrl, pages: [failedUrl] });

  await page.reload();
  await expect(page.getByText("Done")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Retry 1 failed page/ })).toHaveCount(0);
});
