import { test, expect } from "@playwright/test";

/**
 * The full wired journey, end to end: landing form -> /audit?url= -> a real
 * POST /api/audit -> a real SSRF-guarded fetch + Readability extraction of a
 * real public page -> the deterministic mock model (AUDIT_TEST_MOCK=1, see
 * playwright.config.ts) for the two LLM calls -> the live-streamed report
 * rendered by AuditRunner/AuditReportView. Only the LLM calls are mocked;
 * the network fetch, SSRF guard, DET signal computation, and SSE plumbing
 * are all real. https://example.com/ is used as the target because it's a
 * small, stable, always-200 public page Readability can extract from.
 */

test("pastes a URL and gets a rendered report from a real audit", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("textbox", { name: "URL to audit" }).fill("https://example.com/");
  await page.getByRole("button", { name: "Run audit" }).click();

  await page.waitForURL(/\/audit\?url=/);

  // The report header renders once the real `meta` event lands (real fetch, real title).
  await expect(page.getByRole("heading", { name: "Example Domain" })).toBeVisible();
  await expect(page.getByRole("link", { name: /example\.com/ })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );

  // Score rail: all four lens tiles render with a real (engine-computed) score.
  for (const name of [/Answer Engine score/, /Generative Engine score/, /Citability score/, /AI Overview score/]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }

  // The mock model's canned rewrite always lands, proving the full
  // meta -> signals -> scores -> rewrites -> done sequence completed.
  await expect(page.getByText("Answer-first intro", { exact: true })).toBeVisible();

  // No error state — the real pipeline completed successfully end to end.
  // ("Run again" only renders in AuditReportView's error banner; Next.js's
  // own route-announcer also has role="alert", so it's not a safe check here.)
  await expect(page.getByRole("button", { name: "Run again" })).toHaveCount(0);
});
