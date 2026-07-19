import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated coverage output (istanbul) — not source, must not be linted.
    "**/coverage/**",
    // Conductor/Claude may keep nested worktrees and generated builds here.
    // They are separate checkouts, not part of this application's source tree.
    ".claude/**",
    ".conductor/**",
  ]),
]);

export default eslintConfig;
