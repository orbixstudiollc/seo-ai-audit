import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the workbench journey (test/e2e/workbench.spec.ts).
 *
 * The dev server is booted with the e2e escape hatches the app understands:
 *   - E2E_PGLITE=1     -> db/client uses an in-process, migration-applied PGlite
 *                         Postgres, so no external database is needed;
 *   - AUDIT_TEST_MOCK=1 -> buildByokModel returns a deterministic mock model,
 *                         so audits never call a real provider or spend a key.
 * A test-only /api/test/seed route (also gated by E2E_PGLITE) signs a user in
 * through real Better Auth and stores an encrypted BYOK key. Everything else is
 * the real app: real routing, real server actions, real SSE, real rendering.
 */

const PORT = Number(process.env.E2E_PORT ?? 3111);
// Throwaway 32-byte key — only ever encrypts the fake seeded BYOK key.
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

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
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      E2E_PGLITE: "1",
      AUDIT_TEST_MOCK: "1",
      ENCRYPTION_KEY,
      BETTER_AUTH_SECRET: "e2e-better-auth-secret-0123456789abcdef",
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
      // Present but unused (PGlite is active); keeps any stray reference happy.
      DATABASE_URL: "postgres://e2e:e2e@localhost:5432/e2e",
    },
  },
});
