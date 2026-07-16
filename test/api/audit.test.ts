import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/audit/route";
import { DET_SIGNAL_IDS, RUB_SIGNAL_IDS, LENSES } from "@aeo/scoring";
import { createTestServer, type TestServer } from "../helpers/testServer";
import { collectSse, eventTypes } from "../helpers/sse";
import type { AuditStreamEvent } from "@/lib/audit/types";

const ARTICLE_HTML = `<html><head><title>Heat pumps</title></head><body>
<article>
<h1>Heat pumps</h1>
<p>A heat pump moves heat rather than making it, reaching about 300% efficiency in mild climates.</p>
<h2>What does a heat pump cost?</h2>
<p>A typical install runs $4,000 to $8,000, and rebates cover up to $2,000 in many regions.</p>
<h2>How efficient is a heat pump?</h2>
<p>According to the DOE, modern units hold capacity down to -15C, moving three units of heat per unit of electricity.</p>
</article>
</body></html>`;

let server: TestServer;

beforeAll(async () => {
  server = await createTestServer({
    "/article": { body: ARTICLE_HTML, headers: { "content-type": "text/html" } },
    "/not-html": { body: '{"a":1}', headers: { "content-type": "application/json" } },
  });
});

afterAll(() => server.close());

/** Redirects every fetch call to the local test server, preserving path + query,
 * so a public-IP-literal target (passes the SSRF guard without touching DNS)
 * actually resolves to our fixture HTML. */
function forwardFetchToTestServer(): void {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const requested = new URL(typeof input === "string" ? input : input.toString());
    const target = new URL(requested.pathname + requested.search, server.baseUrl);
    return realFetch(target, init);
  });
}

let ipSeq = 0;
function auditRequest(url: string, ip = `10.0.0.${++ipSeq}`): Request {
  return new Request("http://localhost/api/audit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ url }),
  });
}

function findEvent<T extends AuditStreamEvent["type"]>(
  events: AuditStreamEvent[],
  type: T,
): Extract<AuditStreamEvent, { type: T }> | undefined {
  return events.find((e): e is Extract<AuditStreamEvent, { type: T }> => e.type === type);
}

beforeEach(() => {
  process.env.AUDIT_TEST_MOCK = "1";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/audit — happy path", () => {
  it("streams meta -> signals -> scores -> rewrites -> done with a full, contract-shaped payload", async () => {
    forwardFetchToTestServer();

    const res = await POST(auditRequest("http://93.184.216.34/article"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");

    const events = await collectSse(res);
    expect(eventTypes(events)).toEqual(["meta", "signals", "scores", "rewrites", "done"]);

    const meta = findEvent(events, "meta");
    expect(meta?.page.title).toBe("Heat pumps");
    expect(meta?.page.wordCount).toBeGreaterThan(0);
    expect(meta?.page.url).toBe("http://93.184.216.34/article");
    expect(meta?.page.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const signalsEvent = findEvent(events, "signals");
    for (const id of DET_SIGNAL_IDS) {
      expect(signalsEvent?.signals).toHaveProperty(id);
    }

    const scoresEvent = findEvent(events, "scores");
    for (const id of [...DET_SIGNAL_IDS, ...RUB_SIGNAL_IDS]) {
      expect(scoresEvent?.scores.signals).toHaveProperty(id);
    }
    for (const lens of LENSES) {
      expect(scoresEvent?.scores.lenses).toHaveProperty(lens);
    }
    expect(scoresEvent?.findings.qaPairs.length).toBeGreaterThan(0);
    expect(scoresEvent?.findings.quotables).toEqual([]);

    const rewritesEvent = findEvent(events, "rewrites");
    expect(rewritesEvent?.rewrites.hunks.length).toBeGreaterThan(0);

    expect(findEvent(events, "done")).toBeDefined();
    expect(findEvent(events, "error")).toBeUndefined();
  });
});

describe("POST /api/audit — SSRF-blocked URL", () => {
  it("400s... rather, streams a fetch_failed error without ever calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST(auditRequest("http://127.0.0.1:8080/admin"));
    expect(res.status).toBe(200); // the stream itself opens; the failure is an SSE `error` event
    const events = await collectSse(res);

    expect(eventTypes(events)).toEqual(["error"]);
    const error = findEvent(events, "error");
    expect(error?.kind).toBe("fetch_failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/audit — non-HTML content", () => {
  it("streams an unsupported_content error", async () => {
    forwardFetchToTestServer();

    const res = await POST(auditRequest("http://93.184.216.34/not-html"));
    const events = await collectSse(res);

    expect(eventTypes(events)).toEqual(["error"]);
    expect(findEvent(events, "error")?.kind).toBe("unsupported_content");
  });
});

describe("POST /api/audit — invalid request", () => {
  it("400s pre-stream for a non-http(s) URL", async () => {
    const res = await POST(auditRequest("ftp://example.com/file"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_url");
  });

  it("400s pre-stream for a missing url field", async () => {
    const req = new Request("http://localhost/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++ipSeq}` },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_url");
  });
});

describe("POST /api/audit — per-IP rate limit", () => {
  it("rejects the 6th request in a minute from the same IP with 429 + Retry-After", async () => {
    forwardFetchToTestServer();
    const ip = "10.9.9.9";

    const statuses: number[] = [];
    let last: Response | null = null;
    for (let i = 0; i < 6; i++) {
      const res = await POST(auditRequest("http://93.184.216.34/article", ip));
      statuses.push(res.status);
      last = res;
      if (res.status === 200) await collectSse(res); // drain so the stream settles
    }

    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
    expect(last?.headers.get("Retry-After")).toBeTruthy();
    const body = (await last!.json()) as { error: string; retryAfter: number };
    expect(body.error).toBe("rate_limit");
    expect(body.retryAfter).toBeGreaterThan(0);
  });
});
