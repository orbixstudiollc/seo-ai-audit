import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { MOCK_GROWTH_SERIES, MOCK_TRACKED_SITES, MOCK_TRACKED_URL } from "../../lib/growth/mockSeries";

/**
 * G2 tracking UI, mock-first: /api/tracked-sites and /api/growth are
 * page.route-mocked with the §13 canonical mock payloads — the real routes
 * land in g2-api. Seeding matches growth.spec.ts (rising.example is the
 * tracked url).
 */

/** Same seed as growth.spec.ts: two audits of rising.example + one dropping domain. */
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

/** Mock the §13 routes with a tracked rising.example and the canonical series. */
async function routeTrackedState(page: Page) {
  await page.route("**/api/tracked-sites", (route) =>
    route.fulfill({ json: { sites: MOCK_TRACKED_SITES } }),
  );
  await page.route("**/api/growth**", (route) => route.fulfill({ json: MOCK_GROWTH_SERIES }));
}

function risingCard(page: Page) {
  return page.getByRole("listitem").filter({ hasText: "rising.example" });
}

test("track button renders and POSTs the url on click", async ({ page }) => {
  await page.addInitScript(seedHistory);
  let postedBody: string | null = null;
  await page.route("**/api/tracked-sites", (route) => {
    if (route.request().method() === "POST") {
      postedBody = route.request().postData();
      return route.fulfill({
        status: 201,
        json: { site: { url: MOCK_TRACKED_URL, createdAt: "2026-07-20T00:00:00.000Z", lastRunAt: null } },
      });
    }
    return route.fulfill({ json: { sites: [] } });
  });
  await page.route("**/api/growth**", (route) => route.fulfill({ json: MOCK_GROWTH_SERIES }));
  await page.goto("/dashboard");

  await risingCard(page).getByRole("button", { name: "Track daily" }).click();
  await expect(risingCard(page).getByText("Tracking · daily")).toBeVisible();
  expect(JSON.parse(postedBody ?? "{}")).toEqual({ url: MOCK_TRACKED_URL });
});

test("tracked card prefers the daily series with a snapshot-days caption", async ({ page }) => {
  await page.addInitScript(seedHistory);
  await routeTrackedState(page);
  await page.goto("/dashboard");

  const rising = risingCard(page);
  await expect(rising.getByText("30 snapshot days")).toBeVisible();
  // 29 points (30 days minus the err day) proves the DAILY series drives the
  // sparkline — the G1 per-audit series would only have 2.
  await expect(rising.getByRole("img", { name: /across 29 audits/ })).toBeVisible();
  await expect(rising.getByText("Tracking · daily")).toBeVisible();
});

test("changed newest snapshot renders the page-changed badge", async ({ page }) => {
  await page.addInitScript(seedHistory);
  await routeTrackedState(page);
  await page.goto("/dashboard");

  await expect(risingCard(page).getByText("Page changed — run a full audit")).toBeVisible();
});

test("audit_required rejection shows the inline error", async ({ page }) => {
  await page.addInitScript(seedHistory);
  await page.route("**/api/tracked-sites", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({ status: 404, json: { error: "audit_required" } });
    }
    return route.fulfill({ json: { sites: [] } });
  });
  await page.goto("/dashboard");

  const rising = risingCard(page);
  await rising.getByRole("button", { name: "Track daily" }).click();
  await expect(rising.getByText("Run an audit first")).toBeVisible();
  // Still untracked — the toggle stays actionable.
  await expect(rising.getByRole("button", { name: "Track daily" })).toBeVisible();
});

test("growth tab with tracking states has no critical or serious a11y violations", async ({ page }) => {
  await page.addInitScript(seedHistory);
  await routeTrackedState(page);
  await page.goto("/dashboard");
  await expect(risingCard(page).getByText("30 snapshot days")).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const severe = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(severe).toEqual([]);
});

test("tracked cards stay inside the viewport at 320px", async ({ page }) => {
  await page.addInitScript(seedHistory);
  await routeTrackedState(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/dashboard");
  await expect(risingCard(page).getByText("30 snapshot days")).toBeVisible();

  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
});
