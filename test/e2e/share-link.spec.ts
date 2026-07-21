import { test, expect } from "@playwright/test";
import { mockReport } from "../../lib/audit/mockReport";

/**
 * Public share-link flow from a saved report: seed a stored single-page
 * report in IndexedDB, mock POST /api/share, click "Copy public link", and
 * assert the /s/<token> URL lands on the clipboard. The public /s/[token]
 * page itself reads Supabase server-side, so its render is covered by unit
 * tests (loadSharedReport) and the D-007 live smoke after deploy.
 */

const TOKEN = "a".repeat(32);
const AUDIT_ID = "single:https://example.test/page:share-spec";

test("mints a share link from a saved report and copies the public URL", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await page.goto("/");
  await page.evaluate(async ({ id, report }) => {
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
        kind: "single",
        createdAt: "2026-07-21T00:00:00.000Z",
        phase: "done",
        report,
        error: null,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, { id: AUDIT_ID, report: mockReport });

  let shareBody: { auditId?: string } | null = null;
  await page.route("/api/share", async (route) => {
    shareBody = await route.request().postDataJSON() as { auditId?: string };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: TOKEN }) });
  });

  await page.goto(`/report/${encodeURIComponent(AUDIT_ID)}`);
  const shareButton = page.getByRole("button", { name: "Copy public link", exact: true });
  await expect(shareButton).toBeVisible();
  await shareButton.click();

  await expect(page.getByRole("button", { name: "Public link copied", exact: true })).toBeVisible();
  expect(shareBody).toEqual({ auditId: AUDIT_ID });
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard.endsWith(`/s/${TOKEN}`)).toBe(true);
});
