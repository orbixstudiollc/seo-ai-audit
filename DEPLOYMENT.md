# Deployment: Supabase + Vercel

A dashboard-driven guide to deploying this app in production — no CLIs required beyond one local migration command.

## 1. Create the Supabase project

1. [supabase.com](https://supabase.com) → New Project. Pick a region close to where you'll deploy on Vercel.
2. Once provisioned, open **Connect** in the project dashboard and copy two connection strings (both are IPv4-safe; the direct `db.*.supabase.co` host is IPv6-only and won't work from most local networks or Vercel):
   - **Transaction pooler** (port `6543`) — the app's runtime connection.
   - **Session pooler** (port `5432`) — used once, locally, to run migrations.

## 2. Run migrations (locally, once)

```bash
DATABASE_URL="<session-pooler-url>" pnpm db:migrate
```

Use the **session pooler** URL here, not the transaction pooler — migrations need a stable session.

## 3. Generate secrets

```bash
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -base64 32   # BETTER_AUTH_SECRET
```

Run it twice; these must be two different values.

## 4. Deploy to Vercel

1. [vercel.com](https://vercel.com) → Add New Project → import `orbixstudiollc/seo-ai-audit` from GitHub. Next.js is auto-detected; the pnpm workspace at the repo root works as-is, no build config changes needed.
2. Before the first deploy, set these environment variables:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | The **transaction pooler** URL from step 1 |
   | `ENCRYPTION_KEY` | From step 3 |
   | `BETTER_AUTH_SECRET` | From step 3 |
   | `BETTER_AUTH_URL` | Placeholder for now, e.g. `https://placeholder.vercel.app` — fixed in step 5 |

3. Deploy.

## 5. Fix BETTER_AUTH_URL

The first deploy exposes your real `*.vercel.app` URL (or custom domain). Auth cookies and OAuth callbacks need the exact origin, so:

1. Update the `BETTER_AUTH_URL` env var to `https://<your-app>.vercel.app`.
2. Redeploy.

## 6. Never set these in production

| Variable | Why not |
|---|---|
| `E2E_PGLITE` | Switches the DB to an in-process, throwaway Postgres — no data persists. |
| `AUDIT_TEST_MOCK` | Replaces the LLM call with a deterministic mock — audits stop being real. |
| `DEMO_CUSTOM_PROVIDER_KEY` | Auto-provisions a demo account with a live provider key baked in from the environment. |

All three are dev/test-only escape hatches gated by these exact env vars — the demo-login and test-seed routes 404 in any environment where `E2E_PGLITE` isn't `1`.

## 7. Optional: Google OAuth

Google sign-in activates automatically once both are set — no code change needed:

| Variable | What it is |
|---|---|
| `GOOGLE_CLIENT_ID` | From a Google Cloud OAuth client |
| `GOOGLE_CLIENT_SECRET` | From the same OAuth client |

Set the OAuth client's authorized redirect URI to `https://<your-app>.vercel.app/api/auth/callback/google`.

## 8. Verify the deployment

1. Visit your Vercel URL and sign up with a real email/password.
2. Go to **Settings** and add an API key (OpenAI, Anthropic, or a custom-provider endpoint).
3. Import a URL or paste an article.
4. Run an audit and confirm scores render.
5. Check the documents list for the E-E-A-T chip.

## Known ceilings

These are documented limitations, not launch blockers:

- **Rate limiting is in-memory and per-instance** (`lib/audit/ratelimit.ts`). Correct for a single-instance deploy; on multiple serverless instances, limits are not shared (N instances allow N× the intended limit), and they reset on cold start. Upgrade path: swap `checkRateLimit`'s internals for a Postgres or Upstash-backed counter before scaling past one instance.
- **No CSP or other security headers are configured yet** (`X-Frame-Options`, `Strict-Transport-Security`, etc.). Follow-up work, not a launch blocker.
- **Custom domains and Google OAuth are optional** — set up via the Vercel and Google Cloud dashboards respectively whenever you want them; nothing above depends on either.
