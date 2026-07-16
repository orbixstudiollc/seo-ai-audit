import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the anonymous audit journey (test/e2e/*.spec.ts).
 *
 * The dev server is booted with one escape hatch the app understands:
 *   - AUDIT_TEST_MOCK=1 -> the audit route uses a deterministic mock model,
 *                          so audits never call a real provider or spend a key.
 * Everything else is the real app: real routing, real SSE, real rendering.
 * No database and no auth — the tool is anonymous and stateless.
 */

const PORT = Number(process.env.E2E_PORT ?? 3111);

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      AUDIT_TEST_MOCK: "1",
    },
  },
});
