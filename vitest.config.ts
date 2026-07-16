import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// Single root config for the whole workspace. Keeps the default test glob so the
// pre-existing suites under packages/scoring and lib keep running, and adds the
// "@/" path alias the app-layer tests use. The Playwright e2e specs live under
// test/e2e and are excluded here — they run via `playwright test`, not vitest.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\/(.*)$/, replacement: `${rootDir}$1` }],
  },
  test: {
    environment: "node",
    globals: false,
    exclude: ["**/node_modules/**", "**/dist/**", "test/e2e/**", "**/.next/**"],
  },
});
