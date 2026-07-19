import { test, expect } from "@playwright/test";

test("renders persistent local history and manages it from the dashboard", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("seo-ai-audit:history:v1", JSON.stringify([{ id: "single:test", version: 1, url: "https://example.com/", finalUrl: "https://example.com/", title: "Example Domain", mode: "single", createdAt: "2026-07-19T10:00:00.000Z", status: "complete", scores: { aeo: 80, geo: 70, citability: 60, aiOverview: 50 } }])));
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Audit dashboard" })).toBeVisible();
  await expect(page.getByText("Example Domain", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Example Domain", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("No audits saved yet")).toBeVisible();
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
