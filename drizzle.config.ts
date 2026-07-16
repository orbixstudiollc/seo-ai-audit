import { defineConfig } from "drizzle-kit";

// drizzle-kit CLI config — only ever loaded by the `drizzle-kit` binary
// (`db:generate` / `db:migrate` / `db:studio` scripts), never imported by
// the running app. `generate` diffs db/schema.ts against the migration
// history in db/migrations and never opens a database connection, so
// DATABASE_URL is safe to read here even when unset (e.g. no live Neon
// instance in this environment) — only `push`/`migrate`/`studio` need it
// to actually resolve.
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
