import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { MOCK_GROWTH_SERIES, MOCK_TRACKED_SITES, MOCK_TRACKED_URL } from "../../lib/growth/mockSeries";
import { seriesScores } from "../../lib/growth/series";

/**
 * G2 tracking UI, mock-first: /api/tracked-sites and /api/growth are
 * page.route-mocked with the §13 canonical mock payloads — the real routes
 * land in g2-api. Seeding matches growth.spec.ts (rising.example is the
 * tracked url).
 */

/**
 * Scored days in the canonical mock (30 days minus the err day = 29).
 * Derived through the same pure helper the card uses, so the caption and the
 * sparkline aria-label agree by construction; lib/growth/series.test.ts pins
 * the value at 29.
 */
const SCORED_DAYS = seriesScores(MOCK_GROWTH_SERIES.series).length;
const ORPHAN_URL = "https://tracked-only.example/";
const ORPHAN_HEADING = "Also tracking (not in this browser's history)";

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

// MOCK_TRACKED_SITES also tracks tracked-only.example (absent from the seeded
// history), so every tracked-state test renders the orphan Card too — always
// scope "Untrack"/"Tracking · daily" selectors to one card or the orphan row.
function risingCard(page: Page) {
  return page.getByRole("listitem").filter({ hasText: "rising.example" });
}

function orphanRow(page: Page) {
  return page.getByRole("listitem").filter({ hasText: "tracked-only.example" });
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

test("tracked card prefers the daily series with a scored-days caption", async ({ page }) => {
  await page.addInitScript(seedHistory);
  await routeTrackedState(page);
  await page.goto("/dashboard");

  const rising = risingCard(page);
  await expect(rising.getByText(`${SCORED_DAYS} snapshot days`)).toBeVisible();
  // 29 scored points (30 days minus the err day) prove the DAILY series drives
  // the sparkline — the G1 per-audit series would only have 2 — and the noun
  // flips to "days".
  await expect(
    rising.getByRole("img", { name: new RegExp(`across ${SCORED_DAYS} days`) }),
  ).toBeVisible();
  await expect(rising.getByText("Tracking · daily")).toBeVisible();
});

test("changed newest snapshot renders the page-changed badge", async ({ page }) => {
  await page.addInitScript(seedHistory);
  await routeTrackedState(page);
  await page.goto("/dashboard");

  await expect(risingCard(page).getByText("Page changed — run a full audit")).toBeVisible();
});

test("untrack DELETEs the url and reverts to the per-audit card", async ({ page }) => {
  await page.addInitScript(seedHistory);
  let deletedBody: string | null = null;
  await page.route("**/api/tracked-sites", (route) => {
    if (route.request().method() === "DELETE") {
      deletedBody = route.request().postData();
      return route.fulfill({ status: 200, json: { ok: true } });
    }
    return route.fulfill({ json: { sites: MOCK_TRACKED_SITES } });
  });
  await page.route("**/api/growth**", (route) => route.fulfill({ json: MOCK_GROWTH_SERIES }));
  await page.goto("/dashboard");

  const rising = risingCard(page);
  await expect(
    rising.getByRole("img", { name: new RegExp(`across ${SCORED_DAYS} days`) }),
  ).toBeVisible();

  await rising.getByRole("button", { name: "Untrack" }).click();
  await expect(rising.getByRole("button", { name: "Track daily" })).toBeVisible();
  expect(JSON.parse(deletedBody ?? "{}")).toEqual({ url: MOCK_TRACKED_URL });
  // The sparkline falls back to the G1 per-audit series and noun.
  await expect(rising.getByRole("img", { name: /across 2 audits/ })).toBeVisible();
  await expect(rising.getByText("Tracking · daily")).toHaveCount(0);
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

test("tracked-sites API failure falls back to the exact G1 surface", async ({ page }) => {
  await page.addInitScript(seedHistory);
  await page.route("**/api/tracked-sites", (route) =>
    route.fulfill({ status: 500, json: { error: "server" } }),
  );
  await page.goto("/dashboard");

  // Cards render from local history with the per-audit sparkline…
  const rising = risingCard(page);
  await expect(rising.getByRole("img", { name: /across 2 audits/ })).toBeVisible();
  // …and no tracking chrome leaks anywhere: no toggles, no tracked state, no
  // orphan section, no error surfaces.
  await expect(page.getByRole("button", { name: /Track daily|Untrack/ })).toHaveCount(0);
  await expect(page.getByText("Tracking · daily")).toHaveCount(0);
  await expect(page.getByText(/snapshot days/)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: ORPHAN_HEADING })).toHaveCount(0);
  // Scoped to main: the Next.js dev overlay mounts its own empty alert region.
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

test("orphan tracked url renders in its own section with a working untrack", async ({ page }) => {
  await page.addInitScript(seedHistory);
  let deletedBody: string | null = null;
  await page.route("**/api/tracked-sites", (route) => {
    if (route.request().method() === "DELETE") {
      deletedBody = route.request().postData();
      return route.fulfill({ status: 200, json: { ok: true } });
    }
    return route.fulfill({ json: { sites: MOCK_TRACKED_SITES } });
  });
  await page.route("**/api/growth**", (route) => route.fulfill({ json: MOCK_GROWTH_SERIES }));
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: ORPHAN_HEADING })).toBeVisible();
  const orphan = orphanRow(page);
  await expect(orphan.getByText(ORPHAN_URL)).toBeVisible();
  await expect(orphan.getByText("Tracking · daily")).toBeVisible();

  await orphan.getByRole("button", { name: "Untrack" }).click();
  // The whole section disappears once its only orphan is untracked…
  await expect(page.getByRole("heading", { name: ORPHAN_HEADING })).toHaveCount(0);
  expect(JSON.parse(deletedBody ?? "{}")).toEqual({ url: ORPHAN_URL });
  // …while the rising card keeps its own tracked state.
  await expect(risingCard(page).getByText("Tracking · daily")).toBeVisible();
});

test("growth tab with tracking states has no critical or serious a11y violations", async ({ page }) => {
  await page.addInitScript(seedHistory);
  await routeTrackedState(page);
  await page.goto("/dashboard");
  await expect(risingCard(page).getByText(`${SCORED_DAYS} snapshot days`)).toBeVisible();
  await expect(page.getByRole("heading", { name: ORPHAN_HEADING })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  const severe = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(severe).toEqual([]);
});

test("tracked cards and the orphan section stay inside the viewport at 320px", async ({ page }) => {
  await page.addInitScript(seedHistory);
  await routeTrackedState(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/dashboard");
  await expect(risingCard(page).getByText(`${SCORED_DAYS} snapshot days`)).toBeVisible();
  await expect(page.getByRole("heading", { name: ORPHAN_HEADING })).toBeVisible();

  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
});
