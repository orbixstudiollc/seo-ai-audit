import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportedArticle } from "@/lib/import";

const H = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  importFromUrl: vi.fn<(url: string) => Promise<ImportedArticle>>(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => H.session } },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

// Partial mock: importFromUrl is stubbed, but ImportError / the fallback
// message stay real so the action's instanceof mapping is exercised.
vi.mock("@/lib/import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/import")>();
  return { ...actual, importFromUrl: H.importFromUrl };
});

import { importArticleFromUrl } from "@/app/actions/import";
import { ImportError, PASTE_FALLBACK_MESSAGE } from "@/lib/import";

const ARTICLE: ImportedArticle = {
  title: "How to Brew Pour-Over Coffee",
  contentHtml: "<h1>How to Brew Pour-Over Coffee</h1><p>Use a medium-fine grind.</p>",
  excerpt: "Use a medium-fine grind.",
  wordCount: 12,
  finalUrl: "https://example.com/brew",
};

beforeEach(() => {
  H.session = { user: { id: `user-${crypto.randomUUID()}` } };
  H.importFromUrl.mockReset();
});

describe("importArticleFromUrl — auth boundary", () => {
  it("returns a typed unauthorized failure (never throws) when unauthenticated", async () => {
    H.session = null;
    const result = await importArticleFromUrl("https://example.com/brew");
    expect(result).toMatchObject({ ok: false, kind: "unauthorized" });
    expect(H.importFromUrl).not.toHaveBeenCalled();
  });
});

describe("importArticleFromUrl — input validation", () => {
  it("rejects a non-URL input without ever fetching", async () => {
    const result = await importArticleFromUrl("not a url");
    expect(result).toMatchObject({ ok: false, kind: "invalid_url" });
    if (!result.ok) {
      expect(result.userMessage).toMatch(/paste the article text instead/i);
    }
    expect(H.importFromUrl).not.toHaveBeenCalled();
  });
});

describe("importArticleFromUrl — success", () => {
  it("maps the imported article to { title, contentHtml, wordCount, finalUrl }", async () => {
    H.importFromUrl.mockResolvedValue(ARTICLE);
    const result = await importArticleFromUrl("https://example.com/brew");
    expect(result).toEqual({
      ok: true,
      title: ARTICLE.title,
      contentHtml: ARTICLE.contentHtml,
      wordCount: ARTICLE.wordCount,
      finalUrl: ARTICLE.finalUrl,
    });
    expect(H.importFromUrl).toHaveBeenCalledWith("https://example.com/brew");
  });
});

describe("importArticleFromUrl — failure mapping", () => {
  it("maps an SSRF-blocked URL to its kind and honest message", async () => {
    H.importFromUrl.mockRejectedValue(
      new ImportError(
        "blocked",
        "This URL points to a blocked or private network address — paste the article text instead.",
      ),
    );
    const result = await importArticleFromUrl("https://internal.example.com/");
    expect(result).toMatchObject({ ok: false, kind: "blocked" });
    if (!result.ok) {
      expect(result.userMessage).toMatch(/paste the article text instead/i);
    }
  });

  it("maps every ImportError kind straight through", async () => {
    for (const kind of ["timeout", "too_large", "not_html", "fetch_failed"] as const) {
      H.importFromUrl.mockRejectedValueOnce(new ImportError(kind, `${kind} happened`));
      const result = await importArticleFromUrl("https://example.com/brew");
      expect(result).toEqual({ ok: false, kind, userMessage: `${kind} happened` });
    }
  });

  it("converts an unexpected raw error into a typed fetch_failed failure", async () => {
    H.importFromUrl.mockRejectedValue(new TypeError("socket exploded"));
    const result = await importArticleFromUrl("https://example.com/brew");
    expect(result).toEqual({
      ok: false,
      kind: "fetch_failed",
      userMessage: PASTE_FALLBACK_MESSAGE,
    });
  });
});

describe("importArticleFromUrl — rate limit", () => {
  it("allows 10 imports per user per minute, then returns a typed rate_limited failure", async () => {
    H.importFromUrl.mockResolvedValue(ARTICLE);

    for (let i = 0; i < 10; i++) {
      const result = await importArticleFromUrl("https://example.com/brew");
      expect(result.ok).toBe(true);
    }

    const blocked = await importArticleFromUrl("https://example.com/brew");
    expect(blocked).toMatchObject({ ok: false, kind: "rate_limited" });
    if (!blocked.ok) {
      expect(blocked.userMessage).toMatch(/try again in \d+s/i);
    }
    expect(H.importFromUrl).toHaveBeenCalledTimes(10);
  });

  it("keys the bucket per user — another user is unaffected", async () => {
    H.importFromUrl.mockResolvedValue(ARTICLE);
    for (let i = 0; i < 11; i++) {
      await importArticleFromUrl("https://example.com/brew");
    }

    H.session = { user: { id: `user-${crypto.randomUUID()}` } };
    const result = await importArticleFromUrl("https://example.com/brew");
    expect(result.ok).toBe(true);
  });
});
