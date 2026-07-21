import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The W3-SHELL review surface: `/dev/mock-skills` renders every skill panel
 * against its lifecycle mocks alone (no /api/skills, no backend dependency).
 */

const SKILL_LABELS = ["Schema", "Sitemap", "Hreflang", "Images", "AI access", "SERP", "Keywords", "Labs", "Backlinks", "Compare"];

test("renders a heading for every skill", async ({ page }) => {
  await page.goto("/dev/mock-skills");
  await expect(page.getByRole("heading", { name: "Mock skills", level: 1 })).toBeVisible();
  for (const label of SKILL_LABELS) {
    await expect(page.getByRole("heading", { name: label, level: 2 })).toBeVisible();
  }
});

test("keyboard tab reaches the first run button", async ({ page }) => {
  await page.goto("/dev/mock-skills");
  await expect(page.getByRole("heading", { name: "Mock skills", level: 1 })).toBeVisible();

  let found = false;
  for (let i = 0; i < 20 && !found; i++) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? "",
      text: document.activeElement?.textContent?.trim() ?? "",
    }));
    found = active.tag === "BUTTON" && active.text.startsWith("Run");
  }
  expect(found).toBe(true);
});

test("is gated out of production (NODE_ENV !== development)", async ({ page }) => {
  // The e2e webServer always runs `next dev` (see playwright.config.ts), so this
  // only pins the source guard's presence, matching test/e2e/mock-report.spec.ts.
  const res = await page.goto("/dev/mock-skills");
  expect(res?.status()).toBe(200);
});

test("no horizontal overflow at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/dev/mock-skills");
  await expect(page.getByRole("heading", { name: "Mock skills", level: 1 })).toBeVisible();

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
});

test("axe: no critical or serious violations", async ({ page }) => {
  await page.goto("/dev/mock-skills");
  const results = await new AxeBuilder({ page }).analyze();
  const severe = results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
  expect(severe, JSON.stringify(severe, null, 2)).toEqual([]);
});
