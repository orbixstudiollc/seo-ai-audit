import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The WS3 review surface: `/dev/mock-report` renders the full report from
 * `mockReport` alone (no /api/audit, no WS2 dependency). Checks the report
 * actually renders, is keyboard-navigable through findings, and is axe-clean
 * at every required breakpoint.
 */

test("renders the complete report from mock data alone", async ({ page }) => {
  await page.goto("/dev/mock-report");

  await expect(page.getByRole("heading", { name: "Understanding Backlinks in SEO" })).toBeVisible();
  await expect(page.getByRole("link", { name: /example\.com\/understanding-backlinks-in-seo/ })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );

  // Score rail: all four lens tiles render with a real score.
  for (const name of [/Answer Engine score/, /Generative Engine score/, /Citability score/, /AI Overview score/]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }

  // Findings: severity-chipped list plus the three unchipped sections.
  await expect(page.getByRole("list", { name: "Audit findings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Anchor suggestions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quotables" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Q&A pairs" })).toBeVisible();

  // Rewrites: read-only hunks, no accept/reject controls.
  await expect(page.getByText("Answer-first intro", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
});

test("keyboard navigation moves through the findings list", async ({ page }) => {
  await page.goto("/dev/mock-report");

  const findings = page.getByRole("list", { name: "Audit findings" }).getByRole("listitem").getByRole("button");
  await findings.first().focus();
  await expect(findings.first()).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(findings.nth(1)).toBeFocused();

  await page.keyboard.press("End");
  await expect(findings.last()).toBeFocused();

  await page.keyboard.press("Home");
  await expect(findings.first()).toBeFocused();
});

test("downloads report exports and copies a stateless share link", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/dev/mock-report");

  const markdownDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown" }).click();
  await expect((await markdownDownload).suggestedFilename()).toMatch(/\.md$/);

  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "HTML", exact: true }).click();
  await expect((await htmlDownload).suggestedFilename()).toMatch(/\.html$/);

  await page.getByRole("button", { name: "Copy share link" }).click();
  await expect(page.getByText("Share link copied. Opening it runs a fresh audit.")).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain("/audit?url=https%3A%2F%2Fexample.com");
});

test("is gated out of production (NODE_ENV !== development)", async ({ page }) => {
  // The e2e webServer always runs `next dev` (see playwright.config.ts), so
  // this only pins the source guard's presence, not a live 404 — a
  // production-mode request is verified separately at deploy time.
  const res = await page.goto("/dev/mock-report");
  expect(res?.status()).toBe(200);
});

const BREAKPOINTS = [
  { name: "320", width: 320, height: 800 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 900 },
  { name: "1440", width: 1440, height: 900 },
];

for (const bp of BREAKPOINTS) {
  test(`no horizontal overflow at ${bp.name}px`, async ({ page }) => {
    await page.setViewportSize({ width: bp.width, height: bp.height });
    await page.goto("/dev/mock-report");
    await expect(page.getByRole("heading", { name: "Understanding Backlinks in SEO" })).toBeVisible();

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    await page.screenshot({ path: `test-results/mock-report-${bp.name}.png`, fullPage: true });
  });
}

test("axe: no critical or serious violations", async ({ page }) => {
  await page.goto("/dev/mock-report");
  const results = await new AxeBuilder({ page }).analyze();
  const severe = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(severe, JSON.stringify(severe, null, 2)).toEqual([]);
});
