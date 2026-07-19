# SEO AI Audit

**Anonymous v1 feature build complete.** An open, anonymous, low-friction
audit tool: paste a URL, get AI-search audit results back. No account, no
signup, no stored data.

The previous iteration (a self-hosted BYOK dashboard with auth + Postgres) is
preserved in full at branch `backup/pre-rewrite` / tag `backup-pre-rewrite`.
Auth and persistence are deferred to a later phase by explicit product
decision.

## What survives from the previous iteration

- `packages/scoring` — the audit engine: 11 deterministic signals + 7
  LLM-rubric signals, four weighted lenses (AEO / GEO / Citability / AI
  Overview), hard caps, versioned + cache-keyed. Fully tested, no auth or DB
  dependency.
- `lib/import` — URL fetch + readability extraction + SSRF guard (tested).
- `lib/audit` — SSE stream framing, provider factory, rate limiting, error
  mapping, score derivation.
- `lib/export` — markdown / HTML / roadmap report generation.
- `app/components` — score tiles, severity chips, findings/roadmap panels and
  the rest of the results-UI kit.

## Build order

Rebuild happens in phased execution sessions; specs live in `specs/`.

1. **Phase 1** — anonymous landing page with URL input, deployed on Vercel
   (`specs/phase-1.md`).
2. **Phase 2** — anonymous URL → fetch → audit engine → streamed results.
3. **Phase 3** — visual results dashboard.
4. **Phase 4** — dashboard, history/settings, export, share links, schema output, and social metadata.
5. **Supabase Phase 1** — durable anonymous history, reopenable reports, settings, and browser-cache migration.
6. **Cloud Phase 2** — DataForSEO technical crawl and provider cost ledger.
7. **Phase 5** — account identity and cross-device recovery.

## Dev

```bash
pnpm install
pnpm typecheck && pnpm test   # no database, no keys, no env needed
pnpm dev
```
