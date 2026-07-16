// Eager-inits the E2E in-process PGlite database at server boot, so the
// first real request doesn't race db/client.ts's lazy singleton (getDb()
// throws synchronously if the async PGlite migration hasn't finished yet).
// Runtime-guarded: middleware.ts runs on the Edge, which also invokes
// register() — the PGlite/Neon client code is Node-only.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureE2eDb } = await import("@/db/client");
  await ensureE2eDb();
}
