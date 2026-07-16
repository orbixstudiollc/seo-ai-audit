// Test-only environment. The BYOK crypto module (lib/crypto/apiKeys.ts) reads
// ENCRYPTION_KEY lazily on first encrypt/decrypt, so a valid base64 32-byte key
// must be present before any such call. This is a throwaway all-0x07 key — it
// never encrypts anything real, only the fake "sk-test-..." keys the suites seed.
// DATABASE_URL is a placeholder so any stray import of the real db client fails
// loudly with a clear message rather than an undefined-env surprise; the DB-backed
// suites mock @/db/client with an in-process PGlite instance and never hit it.
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
