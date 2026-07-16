# AEO & GEO Optimizer

An open-source, self-hosted content-audit dashboard for AI search. Paste an article and get four 0–100 scores — **AEO** (answer engine optimization), **GEO** (generative engine optimization), **Citability**, and **Google AI Overview** — each backed by per-signal evidence, not vibes. Accept the suggested rewrites and the scores re-compute instantly. Export the optimized article as markdown/HTML plus generated JSON-LD and a prioritized fix roadmap.

**BYOK (bring your own key):** audits run on *your* OpenAI or Anthropic API key. There is no billing, no hosted service, and no telemetry — you self-host it, your key stays encrypted in your database, and the only cost is what your provider charges you.

## How it works

1. **Add content** — paste an article (markdown or plain text) into the workbench.
2. **Audit** — 11 deterministic signals compute instantly in pure TypeScript; 2 LLM calls on your key add 7 rubric signals with verbatim evidence quotes, question gaps, and rewrites. Results stream in live over SSE.
3. **Fix** — accept/reject rewrites per section. Accepting one re-computes the deterministic signals in milliseconds and shows an *estimated* new score; "Re-score" persists your edits and re-runs the full audit against them for a true score.
4. **Export** — optimized markdown/HTML, copy-paste JSON-LD (templated in code from the audit's Q&A pairs, never LLM-generated), and a roadmap where priority = `weight × (100 − score)` summed across the four lenses.

## Scoring at a glance

- **One signal pool, four weighted lenses.** 18 signals are computed once; each headline score (AEO / GEO / Citability / AI Overview) is a weight vector over that shared pool. Weights sum to exactly 100 per lens — enforced by a unit test (`packages/scoring/src/weights.test.ts`), so a weight-table typo fails CI.
- **11 deterministic (DET) signals** — pure TypeScript over a remark/rehype content AST: answer-first intro, snippet-ready blocks, question headings, chunkability, sentence stats, list/table density, schema presence, stat density, citation density, quotable-sentence rate, section self-containedness. Free, instant, bit-identical on every run.
- **7 LLM-rubric (RUB) signals** — answer directness, question-gap coverage, claim verifiability, information uniqueness, definitional clarity, E-E-A-T, AI Overview blockers. Temperature 0, integer scores quantized to steps of 5, and every score must carry a verbatim evidence quote from the article (the anti-inflation anchor).
- **Hard caps make failure legible** — AI Overview is capped at 40 when the answer-first intro signal scores below 30 ("your intro alone caps you"); Citability is capped at 50 when stat density and citation density are both near zero. Cap reasons are shown in the UI.
- **Versioned and reproducible** — `RUBRIC_VERSION` and `SIGNALS_VERSION` are stamped on every audit. The rubric cache key is `sha256(canonicalized content) + rubric_version + model_id`; a cache hit returns stored results with zero API calls. Content canonicalization (NFC, CRLF→LF, zero-width/BOM stripping, smart quotes) means a Google-Docs paste and a plain-text paste of the same article hit the same cache entry.

## Cost (on your own key)

A full 2-call audit of a ~1,500-word article costs roughly **$0.05 on OpenAI** or **$0.08 on Anthropic**, scaled linearly by word count. A pre-run estimate is shown before every audit, and cache hits cost $0. A re-score is a full audit at the same cost — it always re-runs both calls against your edited content, not just the rubric half.

## Self-host quickstart

Requirements: Node.js 20+, [pnpm](https://pnpm.io), and a Postgres database — any standard Postgres works out of the box ([Supabase](https://supabase.com), [Neon](https://neon.tech), RDS, local). Deploying to production? See [DEPLOYMENT.md](DEPLOYMENT.md) for a dashboard-driven Supabase + Vercel walkthrough.

```bash
pnpm install
cp .env.example .env      # .env (not .env.local): drizzle-kit only auto-loads .env
```

Fill in `.env`:

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string (any standard Postgres, see note above) |
| `ENCRYPTION_KEY` | yes | Base64 32-byte key encrypting BYOK provider keys at rest. Generate: `openssl rand -base64 32` |
| `BETTER_AUTH_SECRET` | yes | Better Auth session/signing secret. Generate: `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | yes | Base URL of the deployment, e.g. `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | Enables Google sign-in when both are set; email + password always works |

Then:

```bash
pnpm db:migrate   # apply migrations from db/migrations
pnpm dev          # http://localhost:3000
```

Sign up, add your OpenAI or Anthropic key under **Settings** (validated, then encrypted with AES-256-GCM before storage — see [SECURITY.md](SECURITY.md)), and run your first audit.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest unit + integration suites (LLM fully mocked) |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm e2e` | Playwright end-to-end suite (self-contained, see Testing) |
| `pnpm db:generate` | Generate a migration from `db/schema.ts` changes |
| `pnpm db:migrate` | Apply migrations (needs `DATABASE_URL`) |
| `pnpm db:studio` | Drizzle Studio database browser |
| `pnpm --filter @aeo/scoring cli -- --rank-check` | Scoring-engine CLI over the golden fixture set |

## Architecture

```
packages/scoring/     The engine (isomorphic, no app deps). 18-signal pool,
                      4 lens weight vectors + hard caps, remark/rehype parser,
                      versioned rubric prompt + Zod schema, cache key,
                      golden fixtures + manifest, CLI.
app/app/              The dashboard: document list, /app/doc/[id] workbench
                      (editor left, score rail + findings right), /app/settings
                      (BYOK key vault). Gated by middleware + server-side session.
app/api/audit/        SSE audit pipeline: DET signals first (instant), then the
                      2 LLM calls; per-phase persistence so a dropped connection
                      never loses paid-for results. Rate-limited per user + IP.
app/api/keys/         Validate a provider key (live ping), encrypt, store.
app/actions/          Server actions for document CRUD and key management.
lib/audit/            Pipeline glue: per-request BYOK model construction,
                      typed key-safe error mapping, rate limiter, SSE stream,
                      JSON-LD templating, score derivation.
lib/crypto/           AES-256-GCM for BYOK keys (user-id AAD, key-version byte).
lib/keys/             Provider key validation (OpenAI /models, Anthropic ping).
db/                   Drizzle schema + migrations (Better Auth tables +
                      api_keys / documents / audits).
```

## Testing

Everything runs offline with **zero LLM cost** — no test path ever calls a real provider.

- `pnpm test` — Vitest. The LLM seam is a mock `LanguageModel`; integration tests run against an in-process PGlite Postgres with real migrations applied.
- `pnpm e2e` — Playwright. Boots the real app (`next dev`) with two env-gated escape hatches: `E2E_PGLITE=1` (in-process Postgres, no external DB) and `AUDIT_TEST_MOCK=1` (deterministic mock model). Real routing, real Better Auth, real SSE, real rendering — fake spend.
- `pnpm --filter @aeo/scoring cli -- --rank-check` — runs the engine over 8 golden fixture articles and checks their ranking against `packages/scoring/fixtures/manifest.json`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the determinism gate that governs score-affecting changes.

## Deployment notes

Rate limiting (`lib/audit/ratelimit.ts`) is in-memory and per-instance: correct for the single-instance self-host this project targets, but limits reset on process restart and are not shared across instances (N instances allow N× the limit) — swap the internals of `checkRateLimit` for a Postgres or Upstash counter before any multi-instance deploy. Client IPs are read from `x-forwarded-for`, which is only trustworthy when a proxy or platform you control (Vercel, nginx, etc.) sets it; exposed directly to the internet, that header is client-controlled and the per-IP buckets can be trivially bypassed.

## Positioning discipline

This tool **optimizes citability against known AI-search mechanics** — answer-first structure, extractable passages, verifiable claims, schema markup, the patterns AI engines demonstrably reward. It does **not** claim to predict whether any given LLM will cite you: no ground-truth citation-tracking data backs such a claim, and you should be skeptical of tools that make it.

## License

[MIT](LICENSE)
