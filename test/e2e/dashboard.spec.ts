import { test, expect } from "@playwright/test";

test("renders persistent local history and manages it from the dashboard", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("seo-ai-audit:history:v3", JSON.stringify([{ id: "single:test", version: 3, url: "https://example.com/", finalUrl: "https://example.com/", title: "Example Domain", mode: "single", createdAt: "2026-07-19T10:00:00.000Z", status: "complete", scores: { aeo: 80, geo: 70, citability: 60, aiOverview: 50 }, details: { kind: "single", wordCount: 900, weakestSignals: [{ id: "S1", score: 20 }], blockers: ["Answer buried"], questionGaps: ["How long?"], citationClaims: ["A checkable claim"], rewriteCount: 2 } }])));
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Audit dashboard" })).toBeVisible();
  await expect(page.getByText("Example Domain", { exact: true })).toBeVisible();
  await page.getByText("View details", { exact: true }).click();
  await expect(page.getByText("Weakest signals", { exact: true })).toBeVisible();
  await expect(page.getByText("Answer-first intro", { exact: true })).toBeVisible();
  await expect(page.getByText("Answer buried", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Example Domain", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("No audits saved yet")).toBeVisible();
});

test("audit detail cards remain responsive at 320px", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("seo-ai-audit:history:v3", JSON.stringify([{ id: "single:mobile", version: 3, url: "https://example.com/a-very-long-article-path", title: "A long audit title that should stay inside its card", mode: "single", createdAt: "2026-07-19T10:00:00.000Z", status: "complete", scores: { aeo: 45, geo: 65, citability: 70, aiOverview: 55 }, details: { kind: "single", wordCount: 5215, weakestSignals: [{ id: "S3", score: 0 }], blockers: ["Opinion-framed opening"], questionGaps: [], citationClaims: [], rewriteCount: 4 } }])));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/dashboard");
  await page.getByText("View details", { exact: true }).click();
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
});

test("paginates history ten audits at a time", async ({ page }) => {
  await page.addInitScript(() => {
    const records = Array.from({ length: 12 }, (_, index) => ({
      id: `single:page-${index + 1}`,
      version: 4,
      url: `https://example.com/page-${index + 1}`,
      title: `Audit page ${index + 1}`,
      mode: "single",
      createdAt: new Date(Date.UTC(2026, 6, 19, 10, index)).toISOString(),
      status: "complete",
      scores: { aeo: 80, geo: 70, citability: 60, aiOverview: 50 },
    }));
    localStorage.setItem("seo-ai-audit:history:v4", JSON.stringify(records));
  });
  await page.goto("/dashboard");
  await expect(page.getByRole("navigation", { name: "History pagination" })).toBeVisible();
  await expect(page.getByText("Showing 1–10 of 12", { exact: true })).toBeVisible();
  await expect(page.getByText("Audit page 1", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Page 2 of 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Audit page 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Showing 11–12 of 12", { exact: true })).toBeVisible();
});

test("settings stays available and changes the default audit mode", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.getByLabel("Default audit mode").selectOption("site");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Settings" })).toBeFocused();
  await page.getByLabel("Main navigation").getByRole("link", { name: "New audit" }).click();
  await expect(page.getByRole("radio", { name: "Whole site" })).toHaveAttribute("aria-checked", "true");
});

test("stores a failed query even when no scores were produced", async ({ page }) => {
  await page.route("/api/audit", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"type":"error","kind":"fetch_failed","message":"Fixture fetch failed."}\n\n',
    });
  });
  await page.goto("/audit?url=https%3A%2F%2Ffailed.example%2Farticle");
  await expect(page.getByRole("status")).toContainText("Saved to your dashboard");
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  const failedCard = page.getByRole("listitem").filter({ hasText: "failed.example" });
  await expect(failedCard).toBeVisible();
  await expect(failedCard).toContainText("Failed");
});
