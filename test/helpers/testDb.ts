import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";

/**
 * Real in-process Postgres for the DB-backed suites via PGlite. PGlite is a
 * genuine Postgres 16 build compiled to WASM, so the generated Drizzle
 * migrations apply verbatim and every constraint the app relies on is enforced
 * for real — foreign keys, the api_keys UNIQUE(user_id, provider), and above all
 * the audits partial-unique idempotency index
 * (WHERE status = 'completed'). This is deliberately NOT a query-shape mock: the
 * tests exercise the same SQL a Neon deployment would run.
 *
 * The suites swap the app's Neon client for this one with:
 *   vi.mock("@/db/client", async () => {
 *     const { dbProxy } = await import("../helpers/testDb");
 *     return { db: dbProxy };
 *   });
 * `dbProxy` forwards to whichever PGlite-backed Drizzle instance `initTestDb`
 * most recently created — the same lazy-proxy shape the real client uses, so
 * app code sees an identical `db` object.
 */

export type TestDb = PgliteDatabase<typeof schema>;

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "db",
  "migrations",
);

// Every app app-layer table, child-first so a plain TRUNCATE ... CASCADE between
// tests wipes state without fighting foreign keys. `user` is last because the
// other three reference it.
const APP_TABLES = ["audits", "documents", "api_keys", "user"] as const;

let client: PGlite | undefined;
let active: TestDb | undefined;

export const dbProxy = new Proxy({} as TestDb, {
  get(_target, prop, receiver) {
    if (!active) {
      throw new Error("Test DB not initialized — call initTestDb() in beforeAll.");
    }
    return Reflect.get(active, prop, receiver);
  },
});

/** Spin up a fresh in-memory Postgres and apply the generated migrations to it. */
export async function initTestDb(): Promise<TestDb> {
  client = new PGlite();
  active = drizzle(client, { schema });
  await migrate(active, { migrationsFolder: MIGRATIONS_DIR });
  return active;
}

/** Wipe every app table so each test starts from an empty, isolated database. */
export async function resetTestDb(): Promise<void> {
  if (!client) return;
  await client.exec(
    `TRUNCATE ${APP_TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE;`,
  );
}

/** Tear the instance down after a suite. */
export async function closeTestDb(): Promise<void> {
  await client?.close();
  client = undefined;
  active = undefined;
}

// ---------------------------------------------------------------------------
// Seed helpers — insert the minimal rows a suite needs, directly through the
// active Drizzle client (not the mocked app modules).
// ---------------------------------------------------------------------------

let userSeq = 0;

/** Create a Better-Auth `user` row and return its id. */
export async function seedUser(idPrefix = "user"): Promise<string> {
  if (!active) throw new Error("Test DB not initialized.");
  const id = `${idPrefix}-${++userSeq}`;
  await active.insert(schema.user).values({
    id,
    name: `Test ${id}`,
    email: `${id}@example.test`,
    emailVerified: true,
  });
  return id;
}

/** Insert a document owned by `userId`; returns its generated uuid. */
export async function seedDocument(
  userId: string,
  overrides: Partial<typeof schema.documents.$inferInsert> = {},
): Promise<string> {
  if (!active) throw new Error("Test DB not initialized.");
  const [row] = await active
    .insert(schema.documents)
    .values({
      userId,
      title: overrides.title ?? "Seed document",
      source: overrides.source ?? "paste",
      sourceUrl: overrides.sourceUrl ?? null,
      rawContent: overrides.rawContent ?? "# Seed\n\nBody.",
      contentHash: overrides.contentHash ?? "seed-hash",
      wordCount: overrides.wordCount ?? 2,
    })
    .returning({ id: schema.documents.id });
  return row.id;
}
