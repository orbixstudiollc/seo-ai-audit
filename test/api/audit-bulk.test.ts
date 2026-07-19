import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/audit/bulk/route";
import { createTestServer, type TestServer } from "../helpers/testServer";
import { collectSiteSse, siteEventTypes } from "../helpers/sse";
import type { SiteAuditStreamEvent } from "@/lib/audit/types";

function articlePage(title: string, links: string[] = []): string {
  const linkTags = links.map((href) => `<a href="${href}">${href}</a>`).join("");
  return `<html><head><title>${title}</title></head><body><article><h1>${title}</h1><p>Some article content about ${title.toLowerCase()} that is long enough to extract as a real page.</p></article>${linkTags}</body></html>`;
}

const ROOT_ORIGIN = "http://93.184.216.34";

let sitemapServer: TestServer;
let crawlServer: TestServer;

beforeAll(async () => {
  sitemapServer = await createTestServer({
    "/": { body: articlePage("Home") },
    "/sitemap.xml": {
      body: `<urlset><url><loc>${ROOT_ORIGIN}/a</loc></url><url><loc>${ROOT_ORIGIN}/b</loc></url></urlset>`,
      headers: { "content-type": "application/xml" },
    },
    "/a": { body: articlePage("Page A") },
    "/b": { body: articlePage("Page B") },
  });

  crawlServer = await createTestServer({
    "/": { body: articlePage("Crawl Home", ["/only"]) },
    "/only": { body: articlePage("Only Page") },
  });
});

afterAll(async () => {
  await sitemapServer.close();
  await crawlServer.close();
});

/** Redirects every fetch call to `server`, preserving path + query — see test/api/audit.test.ts. */
function forwardFetchToTestServer(server: TestServer): void {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const requested = new URL(typeof input === "string" ? input : input.toString());
    const target = new URL(requested.pathname + requested.search, server.baseUrl);
    return realFetch(target, init);
  });
}

let ipSeq = 0;
function bulkRequest(url: string, ip = `10.1.0.${++ipSeq}`, limit?: number, pages?: string[]): Request {
  return new Request("http://localhost/api/audit/bulk", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ url, ...(limit !== undefined ? { limit } : {}), ...(pages ? { pages } : {}) }),
  });
}

function findEvent<T extends SiteAuditStreamEvent["type"]>(
  events: SiteAuditStreamEvent[],
  type: T,
): Extract<SiteAuditStreamEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<SiteAuditStreamEvent, { type: T }> => e.type === type);
}

beforeEach(() => {
  process.env.AUDIT_TEST_MOCK = "1";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/audit/bulk — sitemap discovery + full site run", () => {
  it("streams discovery -> per-page events -> rollup -> done for a 3-page sitemap site", async () => {
    forwardFetchToTestServer(sitemapServer);

    const res = await POST(bulkRequest(`${ROOT_ORIGIN}/`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const events = await collectSiteSse(res);
    const types = siteEventTypes(events);

    expect(types[0]).toBe("site:discovery-start");
    expect(types).toContain("site:discovery-done");
    expect(types.at(-1)).toBe("site:done");
    expect(types.filter((t) => t === "site:page-start")).toHaveLength(3); // root + a + b
    expect(types.filter((t) => t === "site:page-done")).toHaveLength(3);

    const discoveryDone = findEvent(events, "site:discovery-done");
    expect(discoveryDone?.method).toBe("sitemap");
    expect(discoveryDone?.pages.map((p) => p.url).sort()).toEqual(
      [`${ROOT_ORIGIN}/`, `${ROOT_ORIGIN}/a`, `${ROOT_ORIGIN}/b`].sort(),
    );

    // Every page's wrapped events reach a real terminal state (done, not error).
    const pageEvents = events.filter((e): e is Extract<SiteAuditStreamEvent, { type: "site:page-event" }> => e.type === "site:page-event");
    const doneEventsByUrl = new Map<string, boolean>();
    for (const e of pageEvents) {
      if (e.event.type === "done") doneEventsByUrl.set(e.url, true);
    }
    expect(doneEventsByUrl.size).toBe(3);

    const rollup = findEvent(events, "site:rollup");
    expect(rollup?.rollup.pagesAudited).toBe(3);
    expect(rollup?.rollup.pagesFailed).toBe(0);
    expect(rollup?.rollup.avgScores).not.toBeNull();
    expect(rollup?.rollup.worstPages.length).toBeGreaterThan(0);
    expect(rollup?.stoppedEarly).toBeNull();

    expect(findEvent(events, "site:error")).toBeUndefined();
  });

  it("respects a caller-supplied limit", async () => {
    forwardFetchToTestServer(sitemapServer);
    const res = await POST(bulkRequest(`${ROOT_ORIGIN}/`, undefined, 1));
    const events = await collectSiteSse(res);
    const discoveryDone = findEvent(events, "site:discovery-done");
    expect(discoveryDone?.pages).toHaveLength(1);
    expect(discoveryDone?.truncated).toBe(true);
  });
});

describe("POST /api/audit/bulk — link-crawl fallback", () => {
  it("falls back to a same-origin link crawl when there is no sitemap", async () => {
    forwardFetchToTestServer(crawlServer);
    const res = await POST(bulkRequest(`${ROOT_ORIGIN}/`));
    const events = await collectSiteSse(res);

    const discoveryDone = findEvent(events, "site:discovery-done");
    expect(discoveryDone?.method).toBe("crawl");
    expect(discoveryDone?.pages.map((p) => p.url).sort()).toEqual(
      [`${ROOT_ORIGIN}/`, `${ROOT_ORIGIN}/only`].sort(),
    );
    expect(findEvent(events, "site:rollup")?.rollup.pagesAudited).toBe(2);
  });
});

describe("POST /api/audit/bulk — failed-page retry", () => {
  it("audits only the supplied same-origin pages without running discovery", async () => {
    forwardFetchToTestServer(sitemapServer);
    const retryPages = [`${ROOT_ORIGIN}/a`, `${ROOT_ORIGIN}/b`, `${ROOT_ORIGIN}/a`];
    const res = await POST(bulkRequest(`${ROOT_ORIGIN}/`, undefined, undefined, retryPages));
    const events = await collectSiteSse(res);

    const discoveryDone = findEvent(events, "site:discovery-done");
    expect(discoveryDone?.method).toBe("retry");
    expect(discoveryDone?.pages.map((page) => page.url).sort()).toEqual(
      [`${ROOT_ORIGIN}/a`, `${ROOT_ORIGIN}/b`].sort(),
    );
    expect(events.filter((event) => event.type === "site:page-start")).toHaveLength(2);
    expect(findEvent(events, "site:rollup")?.rollup.pagesAudited).toBe(2);
    expect(findEvent(events, "site:error")).toBeUndefined();
  });

  it("rejects retry URLs from a different origin before streaming", async () => {
    const res = await POST(bulkRequest(`${ROOT_ORIGIN}/`, undefined, undefined, ["https://other.example/page"]));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_url" });
  });
});

describe("POST /api/audit/bulk — abuse controls", () => {
  it("400s pre-stream for a non-http(s) URL", async () => {
    const res = await POST(bulkRequest("ftp://example.com/"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_url");
  });

  it("429s a second concurrent crawl from the same IP", async () => {
    forwardFetchToTestServer(sitemapServer);
    const ip = "10.9.5.5";

    const first = POST(bulkRequest(`${ROOT_ORIGIN}/`, ip));
    // Fire the second request before the first has finished (still holding the crawl slot).
    const secondRes = await POST(bulkRequest(`${ROOT_ORIGIN}/`, ip));
    expect(secondRes.status).toBe(429);
    const body = (await secondRes.json()) as { error: string };
    expect(body.error).toBe("concurrent_site_limit");

    const firstRes = await first;
    await collectSiteSse(firstRes); // drain so the slot is released and the suite doesn't leak state
  });

  it("rejects the 3rd bulk request within an hour from the same IP with 429 + Retry-After", async () => {
    forwardFetchToTestServer(sitemapServer);
    const ip = "10.9.9.9";

    const statuses: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 3; i++) {
      const res = await POST(bulkRequest(`${ROOT_ORIGIN}/`, ip));
      statuses.push(res.status);
      last = res;
      if (res.status === 200) await collectSiteSse(res); // drain so the crawl slot releases before the next request
    }

    expect(statuses.slice(0, 2)).toEqual([200, 200]);
    expect(statuses[2]).toBe(429);
    expect(last?.headers.get("Retry-After")).toBeTruthy();
    const body = (await last!.json()) as { error: string; retryAfter: number };
    expect(body.error).toBe("rate_limit");
  });
});
