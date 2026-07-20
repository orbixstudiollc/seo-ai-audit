import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Two audits of one domain (score rose 55→75) + one dropping domain. */
function seedHistory() {
  const records = [
    {
      id: "single:rise-old", version: 4, url: "https://rising.example/page", title: "Rising old",
      mode: "single", createdAt: "2026-07-17T10:00:00.000Z", status: "complete",
      scores: { aeo: 55, geo: 55, citability: 55, aiOverview: 55 },
    },
    {
      id: "single:rise-new", version: 4, url: "https://rising.example/page", title: "Rising new",
      mode: "single", createdAt: "2026-07-19T10:00:00.000Z", status: "complete",
      scores: { aeo: 75, geo: 75, citability: 75, aiOverview: 75 },
    },
    {
      id: "single:drop-old", version: 4, url: "https://dropping.example/", title: "Dropping old",
      mode: "single", createdAt: "2026-07-18T10:00:00.000Z", status: "complete",
      scores: { aeo: 80, geo: 80, citability: 80, aiOverview: 80 },
    },
    {
      id: "single:drop-new", version: 4, url: "https://dropping.example/", title: "Dropping new",
      mode: "single", createdAt: "2026-07-19T11:00:00.000Z", status: "complete",
      scores: { aeo: 60, geo: 60, citability: 60, aiOverview: 60 },
    },
  ];
  localStorage.setItem("seo-ai-audit:history:v4", JSON.stringify(records));
}

test("growth tab is the dashboard default and shows per-site progress", async ({ page }) => {
  await page.addInitScript(seedHistory);
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Growth overview" })).toBeVisible();
  // Summary tiles.
  await expect(page.getByText("Sites", { exact: true })).toBeVisible();
  await expect(page.getByText("Audits", { exact: true })).toBeVisible();

  // Rising domain: +20 delta chip and a sparkline.
  const rising = page.getByRole("listitem").filter({ hasText: "rising.example" });
  await expect(rising).toBeVisible();
  await expect(rising).toContainText("+20");
  await expect(rising.getByRole("img", { name: /Score trend/ })).toBeVisible();
  await expect(rising).toContainText("2 audits");

  // Dropping domain flagged in Needs attention with the drop size.
  const attention = page.getByRole("heading", { name: "Needs attention" });
  await expect(attention).toBeVisible();
  await expect(page.getByText("-20 pts since previous audit")).toBeVisible();
});

test("tab switch to History preserves the existing list UI", async ({ page }) => {
  await page.addInitScript(seedHistory);
  await page.goto("/dashboard");
  await page
    .getByRole("navigation", { name: "Dashboard sections" })
    .getByRole("link", { name: "History" })
    .click();
  await expect(page.getByRole("heading", { name: "Audit dashboard" })).toBeVisible();
  await expect(page.getByText("Rising new", { exact: true })).toBeVisible();
});

test("growth empty state invites the first audit", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "No sites yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start an audit →" })).toBeVisible();
});

test("growth tab has no critical or serious accessibility violations", async ({ page }) => {
  await page.addInitScript(seedHistory);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Growth overview" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const severe = results.violations.filter((violation) =>
    violation.impact === "critical" || violation.impact === "serious");
  expect(severe).toEqual([]);
});

test("growth cards stay inside the viewport at 320px", async ({ page }) => {
  await page.addInitScript(seedHistory);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Growth overview" })).toBeVisible();
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
});
