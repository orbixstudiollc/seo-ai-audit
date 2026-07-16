import { test, expect } from "@playwright/test";

/**
 * Throwaway verification (not part of the permanent suite): drives the REAL
 * signup and login forms end to end against the PGlite-migrated schema —
 * everything the workbench spec skips via /api/test/seed. Confirms the exact
 * gap the user asked about: signup, login, and dashboard load all work
 * against a freshly migrated schema.
 */
test("signup creates an account and reaches the dashboard", async ({ page }) => {
  const email = `e2e-auth-${Date.now()}@example.com`;

  await page.goto("/signup");
  await page.getByLabel("Name").fill("E2E Auth Check");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery staple 1");
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByPlaceholder("Paste your article — markdown or plain text.")).toBeVisible();
});

test("login with an existing account reaches the dashboard", async ({ browser }) => {
  const email = `e2e-auth-${Date.now()}-login@example.com`;
  const password = "correct horse battery staple 2";

  const signupContext = await browser.newContext();
  const signupPage = await signupContext.newPage();
  await signupPage.goto("/signup");
  await signupPage.getByLabel("Name").fill("E2E Login Check");
  await signupPage.getByLabel("Email").fill(email);
  await signupPage.getByLabel("Password").fill(password);
  await signupPage.getByRole("button", { name: "Sign up" }).click();
  await expect(signupPage).toHaveURL(/\/app$/);
  await signupContext.close();

  const loginContext = await browser.newContext();
  const loginPage = await loginContext.newPage();
  await loginPage.goto("/login");
  await loginPage.getByLabel("Email").fill(email);
  await loginPage.getByLabel("Password").fill(password);
  await loginPage.getByRole("button", { name: "Log in" }).click();

  await expect(loginPage).toHaveURL(/\/app$/);
  await expect(loginPage.getByPlaceholder("Paste your article — markdown or plain text.")).toBeVisible();
  await loginContext.close();
});
