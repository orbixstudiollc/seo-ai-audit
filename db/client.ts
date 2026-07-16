import path from "node:path";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

type Schema = typeof schema;

// Lazy singleton: constructing the real client (and validating DATABASE_URL)
// only happens on first actual query, not at module import time. Next.js
// evaluates route modules to collect page data during `next build` without
// ever invoking their handlers, so an eager connection here would fail the
// build in any environment without a live DATABASE_URL (this sandbox has
// none by design -- see drizzle.config.ts). The Proxy forwards every
// property access to the memoized real db instance, so callers use `db`
// exactly as before.
let realDb: PostgresJsDatabase<Schema> | undefined;

// ponytail: E2E-only in-process Postgres. Gated behind E2E_PGLITE=1, which only
// the Playwright dev server sets — the branch is unreachable and the PGlite
// (WASM) import never runs in production. It lets the whole dashboard run against
// a real, migration-applied Postgres inside `next dev` with no external DB, so
// the browser e2e exercises the actual drizzle/schema/auth path, not a mock.
//
// The instance lives on globalThis, NOT a module-level `let`: Next.js gives the
// RSC page graph ("react-server") and route handlers SEPARATE module instances,
// so a module singleton set in the seed route is invisible to the /app layout.
// globalThis is process-wide and bridges both. instrumentation.ts eager-inits it
// at boot so it is ready before the first request.
interface E2eDbGlobal {
  db?: PostgresJsDatabase<Schema>;
  ready?: Promise<void>;
}
const e2eStore = globalThis as unknown as { __AEO_E2E_DB__?: E2eDbGlobal };

async function initE2eDb(store: E2eDbGlobal): Promise<void> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: pgliteDrizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const instance = pgliteDrizzle(new PGlite(), { schema });
  await migrate(instance, { migrationsFolder: path.join(process.cwd(), "db", "migrations") });
  // Same drizzle query API as the postgres-js client; the cast keeps `db`'s
  // public type stable so nothing else in the app (or the typecheck) is aware of the swap.
  store.db = instance as unknown as PostgresJsDatabase<Schema>;
}

/** E2E only: build + migrate the in-process PGlite database once. A no-op unless E2E_PGLITE=1. */
export function ensureE2eDb(): Promise<void> {
  if (process.env.E2E_PGLITE !== "1") return Promise.resolve();
  const store = (e2eStore.__AEO_E2E_DB__ ??= {});
  return (store.ready ??= initE2eDb(store));
}

function getDb(): PostgresJsDatabase<Schema> {
  if (process.env.E2E_PGLITE === "1") {
    const store = e2eStore.__AEO_E2E_DB__;
    if (!store?.db) {
      throw new Error("E2E PGlite database not initialized — call ensureE2eDb() first.");
    }
    return store.db;
  }
  if (!realDb) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL environment variable is not set.");
    }
    // prepare:false — required by Supabase's transaction-mode pooler (no
    // prepared statement support); harmless on direct/session connections.
    realDb = drizzle(postgres(databaseUrl, { prepare: false }), { schema });
  }
  return realDb;
}

export const db: PostgresJsDatabase<Schema> = new Proxy({} as PostgresJsDatabase<Schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
