import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

// All target URLs use public IP literals so the SSRF guard passes without DNS.
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { fetchArticle } from "../fetchArticle";

const PAGE = "http://93.184.216.34/article";

function htmlResponse(
  body: string,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(body, {
    status: init?.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", ...init?.headers },
  });
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchArticle — happy path", () => {
  it("returns html, extracted <title> and the final URL", async () => {
    fetchMock.mockResolvedValue(
      htmlResponse("<html><head><title>Fetch &amp; Win</title></head><body>hi</body></html>"),
    );
    const result = await fetchArticle(PAGE);
    expect(result.title).toBe("Fetch & Win");
    expect(result.html).toContain("<body>hi</body>");
    expect(result.finalUrl).toBe(PAGE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>)["user-agent"]).toContain("Mozilla/5.0");
  });

  it("follows up to 3 validated redirect hops and reports the final URL", async () => {
    fetchMock
      .mockResolvedValueOnce(redirectResponse("http://93.184.216.34/moved", 301))
      .mockResolvedValueOnce(redirectResponse("/final")) // relative Location
      .mockResolvedValueOnce(htmlResponse("<title>Done</title>"));
    const result = await fetchArticle(PAGE);
    expect(result.title).toBe("Done");
    expect(result.finalUrl).toBe("http://93.184.216.34/final");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("fetchArticle — SSRF on redirects", () => {
  it("blocks a redirect to an internal target and never fetches it", async () => {
    fetchMock.mockResolvedValueOnce(
      redirectResponse("http://169.254.169.254/latest/meta-data/"),
    );
    await expect(fetchArticle(PAGE)).rejects.toMatchObject({ kind: "blocked" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // guard fired before hop 2
  });

  it("blocks the initial URL itself before any fetch", async () => {
    await expect(fetchArticle("http://127.0.0.1:8080/admin")).rejects.toMatchObject({
      kind: "blocked",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails after more than 3 redirect hops", async () => {
    fetchMock.mockResolvedValue(redirectResponse("http://93.184.216.34/loop"));
    await expect(fetchArticle(PAGE)).rejects.toMatchObject({ kind: "fetch_failed" });
    expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 followed hops
  });
});

describe("fetchArticle — response validation", () => {
  it("rejects non-HTML content types", async () => {
    fetchMock.mockResolvedValue(
      new Response('{"a":1}', { status: 200, headers: { "content-type": "application/json" } }),
    );
    await expect(fetchArticle(PAGE)).rejects.toMatchObject({
      kind: "not_html",
      message: expect.stringContaining("paste the article text"),
    });
  });

  it("rejects a declared content-length above 2MB without reading the body", async () => {
    fetchMock.mockResolvedValue(
      htmlResponse("tiny", { headers: { "content-length": String(3 * 1024 * 1024) } }),
    );
    await expect(fetchArticle(PAGE)).rejects.toMatchObject({ kind: "too_large" });
  });

  it("aborts a streaming body once it passes the 2MB cap", async () => {
    const megabyte = new Uint8Array(1024 * 1024).fill(97); // 'a'
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 10) {
          controller.close(); // safety valve: cap must trip long before this
          return;
        }
        controller.enqueue(megabyte);
      },
    });
    fetchMock.mockResolvedValue(
      new Response(stream, { status: 200, headers: { "content-type": "text/html" } }),
    );
    await expect(fetchArticle(PAGE)).rejects.toMatchObject({
      kind: "too_large",
      message: expect.stringContaining("paste the article text"),
    });
    expect(pulls).toBeLessThanOrEqual(4);
  });

  it("maps HTTP error statuses to fetch_failed", async () => {
    fetchMock.mockResolvedValue(htmlResponse("nope", { status: 403 }));
    await expect(fetchArticle(PAGE)).rejects.toMatchObject({
      kind: "fetch_failed",
      message: expect.stringContaining("403"),
    });
  });
});

describe("fetchArticle — failure modes", () => {
  it("times out via the abort signal", async () => {
    fetchMock.mockImplementation(
      (_url: URL, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener("abort", () => reject(signal.reason as Error));
        }),
    );
    await expect(fetchArticle(PAGE, { timeoutMs: 25 })).rejects.toMatchObject({
      kind: "timeout",
      message: expect.stringContaining("paste the article text"),
    });
  });

  it("maps network errors to fetch_failed with the paste fallback", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(fetchArticle(PAGE)).rejects.toMatchObject({
      kind: "fetch_failed",
      message: expect.stringContaining("paste the article text"),
    });
  });
});
