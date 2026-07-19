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
});
