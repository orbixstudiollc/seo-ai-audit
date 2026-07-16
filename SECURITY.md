# Security Policy

This is a self-hosted BYOK (bring-your-own-key) application: the most sensitive data it holds is its users' OpenAI/Anthropic API keys. The design decisions below exist to protect exactly that.

## How BYOK keys are stored

Implementation: `lib/crypto/apiKeys.ts` (tests incl. negative cases: `lib/crypto/apiKeys.test.ts`).

- **AES-256-GCM** via `node:crypto`, keyed by the 32-byte base64 `ENCRYPTION_KEY` env secret (`openssl rand -base64 32`). A fresh random 12-byte IV is generated per encryption (96-bit, the NIST SP 800-38D recommended GCM length).
- **Per-user AAD binding**: the owning user's id is the GCM additional authenticated data. The ciphertext is cryptographically bound to its row owner — decrypting under any other user id fails authentication and throws. Tampered or truncated blobs likewise throw; those failures are never caught and silenced.
- **Key-version byte for rotation**: the stored blob layout is `keyVersion(1B) ‖ iv(12B) ‖ authTag(16B) ‖ ciphertext`, base64-encoded, mirrored by a `key_version` column on `api_keys`. Rotating `ENCRYPTION_KEY` means registering the old key under its version for decryption while new writes use the new key — no big-bang re-encrypt migration, no window where old rows stop decrypting.
- **Hint-only display**: after the initial submit (HTTPS POST → live provider validation → encrypt → store), the client only ever sees a `key_hint` such as `sk-...abc4` / `sk-ant-...wxyz`. No endpoint returns plaintext key material, ever.
- **Request-scoped decryption**: plaintext keys exist only inside the handling request, in a local variable passed to the per-request AI SDK model factory (`lib/audit/provider.ts`). They are never cached, memoized, or hoisted into module or global state.

## The never-log discipline

Raw AI SDK/provider errors can transitively embed request config — including the `Authorization` header carrying the user's key. So:

- **One choke point** (`lib/audit/errors.ts`) converts every raw provider error into a typed `AuditError { provider, kind, retryAfterSec?, userMessage }`. It reads only key-free primitives off the raw error (numeric status code, `retry-after` header, and the provider's machine-readable error-code token for quota classification) and authors its own message. The original error object is never returned, re-thrown, nested, or logged.
- If a failure must be logged, only a stripped projection (constructor name + status code) is available — a logger physically cannot receive key material through it.
- AI SDK telemetry (`experimental_telemetry`) is never enabled on BYOK-bearing calls, keeping prompts and keys out of any tracing pipeline.
- No `console.log` in the key-handling and audit modules; contributions that add logging near key material are rejected in review.

## URL import and SSRF

The server **does fetch user-supplied URLs** for the "Import URL" flow, so SSRF is a live surface. Every fetch goes through the hard guard in `lib/import/ssrfGuard.ts` (tests incl. bypass attempts: `lib/import/__tests__/ssrfGuard.test.ts`):

- `http(s)` schemes only, and URLs with embedded credentials are rejected;
- IP literals (v4 and v6, including obfuscated forms — WHATWG URL parsing canonicalizes `http://2130706433/` to `127.0.0.1` before the check) and **every DNS-resolved address** of a hostname are checked against deny-lists for private, loopback, link-local, CGNAT, unique-local, NAT64/IPv4-mapped, and cloud-metadata ranges (e.g. `169.254.169.254`) — one bad address rejects the whole name;
- redirects are followed manually (max 3 hops) with the guard re-run on **every** hop, not just the first URL, so a public URL 302-ing to internal infrastructure dies at the hop;
- responses are size-capped at 2MB (enforced while streaming, not just via `content-length`), time-capped at 10s, and non-HTML content types are rejected.

The import server action is additionally auth-gated and rate-limited per user, and every failure surfaces to the UI as a typed error with a paste-the-text fallback — pasting always works.

## Other hardening in place

- **Auth gating**: the dashboard and all key/audit endpoints require a valid Better Auth session; middleware provides a cheap edge-level gate and the server layout performs the authoritative session check.
- **Rate limiting**: the audit endpoint is token-bucket rate-limited per user and per IP (`lib/audit/ratelimit.ts`) — note the limiter is in-memory and per-instance, sized for the single-instance self-hosted deployment this project targets.
- **Idempotency guard**: a partial unique index on completed audits plus an application-level running-audit check prevent double-submits from double-spending a user's LLM budget.
- **Offline test suite**: no test or CI path ever holds real provider keys (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## Self-hosting responsibilities

You operate your own instance, so you own: keeping `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` secret and out of version control (only `.env.example` with placeholders is committed), serving the app over HTTPS, securing your Postgres, and rotating any secret you suspect is exposed (for `ENCRYPTION_KEY`, via the key-version rollover above).

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems.**

Use GitHub's private vulnerability reporting: **Security tab → "Report a vulnerability"** on this repository. Include the affected component/file, reproduction steps, and impact assessment. You should receive an acknowledgment within a few days; coordinated disclosure after a fix is available is appreciated.

If you accidentally exposed your own provider key while using or developing this app, revoke it in your provider dashboard (OpenAI/Anthropic) immediately — treat that as compromised regardless of anything this app does.
