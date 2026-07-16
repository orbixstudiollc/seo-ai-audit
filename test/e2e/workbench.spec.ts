import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { E2E_ARTICLE, E2E_INTRO_AFTER, E2E_WEAK_INTRO } from "../../lib/audit/e2eFixture";

/**
 * The full browser workbench journey against a real `next dev` server:
 *
 *   seed a real Better Auth session -> /app -> paste the fixture article ->
 *   create the document -> Run audit (real SSE, mock LLM) -> score tiles render
 *   -> rewrites render -> accept the intro hunk -> estimated re-score moves the
 *   AI Overview bar up -> Re-score re-runs the pipeline -> axe finds no
 *   critical/serious a11y violations on the workbench.
 *
 * The dev server runs with E2E_PGLITE=1 (in-process Postgres) and
 * AUDIT_TEST_MOCK=1 (deterministic mock model) — see playwright.config.ts.
 * `after()` durably persists the audit server-side, so a short settle before the
 * true re-score guarantees the first run is `completed` (not still `running`).
 */

const AIO_SCORE_RE = /AI Overview score (\d+) out of 100/;

async function aioScore(page: Page): Promise<number> {
  const label = await page.getByRole("button", { name: /AI Overview score/ }).getAttribute("aria-label");
  const match = label?.match(AIO_SCORE_RE);
  if (!match) throw new Error(`AI Overview tile has no numeric score yet: ${label}`);
  return Number(match[1]);
}

test("authed user audits a pasted article, accepts a rewrite, and re-scores — a11y clean", async ({
  page,
}) => {
  // 1. Seed a real, signed-in user (real Better Auth cookies) + a stored key.
  const seed = await page.request.post("/api/test/seed");
  expect(seed.ok(), `seed failed: ${seed.status()} ${await seed.text()}`).toBeTruthy();

  // 2. Land on the empty dashboard; its first-run form is open by default.
  await page.goto("/app");
  const paste = page.getByPlaceholder("Paste your article — markdown or plain text.");
  await expect(paste).toBeVisible();
  await paste.fill(E2E_ARTICLE);

  // 3. Create the document -> navigate into the workbench.
  await page.getByRole("button", { name: "Run audit" }).click();
  await page.waitForURL(/\/app\/doc\/[0-9a-f-]{36}/);

  const editor = page.getByLabel("Working document content");
  await expect(editor).toHaveValue(/Heat pumps/);

  // 4. Run the audit (cache miss -> real SSE stream driven by the mock model).
  const [auditResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/audit") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Run audit" }).click(),
  ]);
  expect(auditResponse.status()).toBe(200);

  // 5. Scores render: the AI Overview tile gets a real numeric score.
  const aioTile = page.getByRole("button", { name: /AI Overview score/ });
  await expect(aioTile).toHaveAttribute("aria-label", AIO_SCORE_RE);
  const trueAio = await aioScore(page);

  // 6. Rewrites render: the intro hunk is offered with an Accept control.
  await page.getByRole("tab", { name: "Rewrites" }).click();
  const accept = page.getByRole("button", { name: "Accept" }).first();
  await expect(accept).toBeVisible();

  // 7. Accept the intro hunk -> the working doc updates and the estimated
  //    re-score lifts the AI Overview bar above its true (weak-intro) score.
  await accept.click();
  await expect(page.getByText("Estimated — re-score to confirm")).toBeVisible();
  await expect(editor).not.toHaveValue(new RegExp(escapeRegExp(E2E_WEAK_INTRO)));
  expect(await editor.inputValue()).toContain(E2E_INTRO_AFTER);
  await expect
    .poll(async () => aioScore(page), { message: "estimated AI Overview should rise above the true score" })
    .toBeGreaterThan(trueAio);

  // 8. True re-score: Re-score persists the edited working doc FIRST (new
  //    content hash -> cache miss), so the pipeline freshly scores the accepted
  //    intro instead of cache-hitting the stale stored content. Let after()
  //    finish persisting the first audit before kicking it off.
  await page.waitForTimeout(2000);
  const [rescoreResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/audit") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Re-score" }).click(),
  ]);
  expect(rescoreResponse.status()).toBe(200);
  // The score rail settles back out of the streaming state (model line reappears).
  await expect(page.getByText(/^model/)).toBeVisible();

  // 8b. Estimated -> true transition: the fresh audit's scores pair with the
  //     saved working doc, so the estimated flag clears into a confirmed true
  //     score that beats the original weak-intro score.
  await expect(page.getByText("True rubric score")).toBeVisible();
  await expect(page.getByText("Estimated — re-score to confirm")).not.toBeVisible();
  expect(await aioScore(page)).toBeGreaterThan(trueAio);

  // 8c. The accepted rewrite was persisted, so it survives a reload.
  await page.reload();
  await expect(page.getByLabel("Working document content")).toHaveValue(
    new RegExp(escapeRegExp(E2E_INTRO_AFTER)),
  );

  // 9. Accessibility: no critical/serious violations on the rendered workbench.
  const results = await new AxeBuilder({ page }).include(".workbench").analyze();
  const seriousViolations = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(
    seriousViolations,
    `axe violations:\n${JSON.stringify(seriousViolations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })), null, 2)}`,
  ).toEqual([]);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
