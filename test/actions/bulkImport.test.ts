import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { ImportedArticle } from "@/lib/import";

const H = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  importFromUrl: vi.fn<(url: string) => Promise<ImportedArticle>>(),
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => H.session } },
}));

vi.mock("@/db/client", async () => {
  const { dbProxy } = await import("../helpers/testDb");
  return { db: dbProxy };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

// Partial mock, same pattern as test/actions/import.test.ts: only the actual
// network-touching function is stubbed, so ImportError stays real.
vi.mock("@/lib/import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/import")>();
  return { ...actual, importFromUrl: H.importFromUrl };
});

import { bulkImportArticles } from "@/app/actions/bulkImport";
import { ImportError } from "@/lib/import";
import { documents } from "@/db/schema";
import { MAX_ARTICLE_LIST_ROWS } from "@/lib/csv/constants";
import { closeTestDb, dbProxy, initTestDb, resetTestDb, seedUser } from "../helpers/testDb";

function article(title: string, url: string): ImportedArticle {
  return {
    title,
    contentHtml: `<h1>${title}</h1><p>Body text for ${title}.</p>`,
    excerpt: `Body text for ${title}.`,
    wordCount: 10,
    finalUrl: url,
  };
}

beforeAll(async () => {
  await initTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  H.session = null;
  H.importFromUrl.mockReset();
});

describe("bulkImportArticles — auth boundary", () => {
  it("returns a fatal, non-throwing failure when unauthenticated", async () => {
    H.session = null;
    const result = await bulkImportArticles("url\nhttps://example.com/a\n");
    expect(result).toMatchObject({ ok: false, fatalError: expect.stringMatching(/signed in/i) });
    expect(H.importFromUrl).not.toHaveBeenCalled();
  });
});

describe("bulkImportArticles — CSV validation", () => {
  it("fatal error, nothing imported, when the CSV has no url column", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    const result = await bulkImportArticles("title\nSomething\n");
    expect(result.ok).toBe(false);
    expect(result.fatalError).toMatch(/url/i);
    expect(H.importFromUrl).not.toHaveBeenCalled();
    expect(await dbProxy.select().from(documents)).toHaveLength(0);
  });

  it("fatal error, nothing imported, when the CSV exceeds the row cap", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    const rows = Array.from({ length: MAX_ARTICLE_LIST_ROWS + 1 }, (_, i) => `https://example.com/${i}`);
    const result = await bulkImportArticles("url\n" + rows.join("\n") + "\n");
    expect(result.ok).toBe(false);
    expect(result.fatalError).toMatch(new RegExp(String(MAX_ARTICLE_LIST_ROWS)));
    expect(H.importFromUrl).not.toHaveBeenCalled();
  });

  it("rejects an oversized CSV file before parsing it at all", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    const huge = "url\n" + "https://example.com/a\n".repeat(10_000); // well over the char cap
    const result = await bulkImportArticles(huge);
    expect(result.ok).toBe(false);
    expect(result.fatalError).toMatch(/too large/i);
    expect(H.importFromUrl).not.toHaveBeenCalled();
  });
});

describe("bulkImportArticles — success", () => {
  it("imports each row into its own document, using the CSV title over the page's own title", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    H.importFromUrl.mockImplementation(async (url) =>
      article(`Page title for ${url}`, url),
    );

    const csv = "url,title\nhttps://example.com/a,CSV Title A\nhttps://example.com/b,\n";
    const result = await bulkImportArticles(csv);

    expect(result.ok).toBe(true);
    expect(result.failed).toEqual([]);
    expect(result.created).toHaveLength(2);
    // Row with a CSV title uses it; row with a blank title cell falls back to the page's title.
    expect(result.created[0]).toMatchObject({ url: "https://example.com/a", title: "CSV Title A" });
    expect(result.created[1]).toMatchObject({
      url: "https://example.com/b",
      title: "Page title for https://example.com/b",
    });

    const rows = await dbProxy.select().from(documents).where(eq(documents.userId, userId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === "url")).toBe(true);
  });

  it("partial failure: one row's import throws, the rest still succeed and get created", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    H.importFromUrl.mockImplementation(async (url) => {
      if (url === "https://example.com/broken") {
        throw new ImportError("blocked", "This URL points to a blocked or private network address.");
      }
      return article(`Title for ${url}`, url);
    });

    const csv = [
      "url",
      "https://example.com/a",
      "https://example.com/broken",
      "https://example.com/b",
    ].join("\n");
    const result = await bulkImportArticles(csv);

    expect(result.ok).toBe(true);
    expect(result.created.map((c) => c.url)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(result.failed).toEqual([
      { url: "https://example.com/broken", reason: expect.stringMatching(/blocked/i) },
    ]);

    const rows = await dbProxy.select().from(documents).where(eq(documents.userId, userId));
    expect(rows).toHaveLength(2); // the broken row never got a document
  });

  it("a non-ImportError failure (e.g. a raw thrown error) is still caught and reported per-row, not thrown from the action", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    H.importFromUrl.mockRejectedValue(new TypeError("socket exploded"));

    const result = await bulkImportArticles("url\nhttps://example.com/a\n");
    expect(result.ok).toBe(true);
    expect(result.created).toEqual([]);
    expect(result.failed).toEqual([
      { url: "https://example.com/a", reason: expect.any(String) },
    ]);
  });
});

describe("bulkImportArticles — rate limit", () => {
  it("allows 3 bulk uploads per user in the window, then returns a typed fatal rate-limit error", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    H.importFromUrl.mockResolvedValue(article("A", "https://example.com/a"));

    for (let i = 0; i < 3; i++) {
      const result = await bulkImportArticles("url\nhttps://example.com/a\n");
      expect(result.ok).toBe(true);
    }

    const blocked = await bulkImportArticles("url\nhttps://example.com/a\n");
    expect(blocked.ok).toBe(false);
    expect(blocked.fatalError).toMatch(/too many bulk uploads/i);
  });

  it("keys the bucket per user — another user is unaffected", async () => {
    const userId = await seedUser("a");
    H.session = { user: { id: userId } };
    H.importFromUrl.mockResolvedValue(article("A", "https://example.com/a"));
    for (let i = 0; i < 4; i++) {
      await bulkImportArticles("url\nhttps://example.com/a\n");
    }

    const otherUserId = await seedUser("b");
    H.session = { user: { id: otherUserId } };
    const result = await bulkImportArticles("url\nhttps://example.com/a\n");
    expect(result.ok).toBe(true);
  });
});
