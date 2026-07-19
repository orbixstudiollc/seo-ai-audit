import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("landing page renders hero and a focusable URL form", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const input = page.getByRole("textbox", { name: "URL to audit" });
  // .last(): several ancestor divs "have" the input; the closest one (the
  // styled input wrapper itself, carrying the focus-within style) is last
  // in document order among outer-to-inner matches.
  const wrapper = page.locator("div", { has: input }).last();
  const borderBefore = await wrapper.evaluate((el) => getComputedStyle(el).borderColor);

  await input.focus();
  await expect(input).toBeFocused();

  // A visible focus treatment, not just programmatic focus (WCAG 2.4.7).
  const borderAfter = await wrapper.evaluate((el) => getComputedStyle(el).borderColor);
  expect(borderAfter).not.toBe(borderBefore);
});

test("invalid URL shows an inline error and stays on the landing page", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "URL to audit" });
  await input.fill("not a url");
  await page.getByRole("button", { name: "Run audit" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "Enter a full URL" })).toBeVisible();
  await expect(page).toHaveURL("/");
});

test("valid URL routes to /audit and shows the audited URL", async ({ page }) => {
  await page.goto("/");
  const target = "https://example.com/some-article";
  const input = page.getByRole("textbox", { name: "URL to audit" });
  await input.fill(target);
  await page.getByRole("button", { name: "Run audit" }).click();

  await page.waitForURL(/\/audit\?url=/);
  await expect(page.getByText(target)).toBeVisible();
});

test("landing page has no critical or serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  const seriousViolations = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(
    seriousViolations,
    `axe violations:\n${JSON.stringify(seriousViolations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })), null, 2)}`,
  ).toEqual([]);
});
