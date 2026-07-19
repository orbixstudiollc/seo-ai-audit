# PROJECT-STATUS — SEO AI Audit v1

**The single canonical source of truth for this project.** Every session
updates this file before wrapping up (see the closing ritual in
`docs/COORDINATION.md`) and appends a handoff entry to `docs/HANDOFF.md`.
Detail lives in `docs/` (phases, contract, decisions); this file is the map.

Last updated: 2026-07-20 · by: cloud completion session · branch `main`

## Product

Open, anonymous-first, low-friction tool: paste a URL → streamed AI-search audit
(AEO / GEO / Citability / AI Overview scores + evidence-backed findings).
No signup is required; audit queries and reports have a Supabase-backed durable
store with a browser fallback, and optional email-link sign-in enables
cross-device recovery. **Live:**
https://seo-ai-audit-pied.vercel.app

## Current status (one paragraph)

The anonymous-first product and durable Supabase storage are live. The
DataForSEO technical-crawl phase is deployed and awaits provider credentials
for its live paid-task proof. Phase 5 optional account recovery is implemented;
its production migration and Auth URLs are configured. The product supports
single-page and whole-site audits of up to 500 discovered pages,
streamed per-page results and site rollups, pinned-IP SSRF protection, and
Anthropic or OpenAI-compatible providers. Release gates are green: lint,
typecheck, 241 unit/integration tests, production build, and 21 Playwright
journeys. Production was directly deployed and smoke-tested on 2026-07-19:
the whole-site selector and route are live, the bulk endpoint validates bad
input correctly, and the security headers, robots.txt, and llms.txt are present.
Phase 4 adds dashboard/history/settings, local report exports, stateless share
links, FAQ JSON-LD, result social metadata, and a validated plain-JSON fallback
for providers that reject structured output. A real production audit completed
through both provider calls and saved its compact history record.
Every submitted query is cached locally and synchronized to private Supabase
tables through server-only routes.
Completed reports can be reopened from cloud or IndexedDB; the dashboard
supports 500 records and paginates 10 cards at a time. Failed bulk pages can be
retried individually. The ownership migration passed a rollback-only production
database test. Current gates: lint/typecheck/build, 270 tests, and 22
Playwright journeys.
Production uses Claude Haiku 4.5 for both scoring and rewrites to minimize LLM cost.

## Plan → status

| # | Workstream / phase | Branch | Status |
|---|---|---|---|
| 0 | Teardown + clean slate + docs/contract/specs | `main` `004f754`+`52a78c7` | ✅ done |
| 1 | WS1 scaffold: landing, /audit shell, llms.txt, deploy | `ws1-scaffold` `3fdc239` | ✅ merged + deployed |
| 2 | WS2 audit API: SSRF-guarded fetch → DET+RUB → SSE per contract | `ws2-audit-api` `48feb82` | ✅ merged + deployed |
| 3 | WS3 results UI: dashboard vs DATA-CONTRACT mock | `ws3-results-ui` `b7736dd` | ✅ merged + deployed |
| 4 | Integration: merges, /audit wiring, dead-file cleanup, e2e, prod deploy | `integrate-v1` → `main` `ac1b7fe` | ✅ done |
| 5 | Coordinator review pass 1 (all three WS + integration) | reviews in `docs/phases/ws*-report.md` | ✅ done |
| 6 | Provider-flex: `AI_PROVIDER`/`AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL` — Anthropic or any OpenAI-compatible endpoint (OpenRouter, zenmuz, Ollama) + WS1-gaps quick fixes (focus state, security headers) | `provider-flex` `3939732` | ✅ merged + deployed |
| 7 | WS4 crawl + bulk: bulk audit, site crawl, SSRF pinned-IP fix | `ws4-bulk-audit-crawl` `2cc82fe` | ✅ merged + deployed |
| 8 | Phase 4a: dashboard, browser-local history, global settings | `main` via PR #1 | ✅ merged + deployed |
| 9 | Phase 4b: export, share, schema output, result OG | `main` via PR #1 | ✅ merged + deployed |
| 10 | Supabase Phase 1: anonymous durable history/reports/settings | `main` `11b879e`+ | ✅ migrated + deployed + validated |
| 11 | Cloud Phase 2: DataForSEO technical crawl + usage ledger | `main` `e9a1269` | ✅ implemented + deployed; credentials needed for live provider task |
| 12 | Phase 5: optional account auth + cross-device identity | `main` `7b51ac2` | ✅ implemented + migrated + deployed + live data path validated |

## Pending user actions

1. Add server-only `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` in Vercel for
   the required low-limit live provider validation.
2. Configure custom SMTP in Supabase Auth for production email capacity; the
   built-in sender is limited to two emails per hour.
3. Optional cleanup: delete stale `DATABASE_URL` / `BETTER_AUTH_*` /
   `ENCRYPTION_KEY` vars from Vercel (WS1 report, open question 1).

## Key decisions (full log: `docs/DECISIONS.md`)

- D-011 supersedes D-001's no-database portion; D-012 authorizes the remaining
  provider/account phases; D-013 keeps account recovery optional and server-owned.
- D-004 SSE contract v1: `meta → signals → scores → rewrites → done`
  (DATA-CONTRACT v1.0 — the law for all workstreams).
- D-005 no det-only degraded mode; D-006 share link = re-run;
  D-008 per-IP in-memory rate limit; D-007 deploys verified by real HTTP.
- D-010 coordinator/executor model — see Process below.

## Process (standing protocol)

- **One fresh Conductor session per workstream/phase.** Specs in
  `docs/phases/`; branch names + file-ownership boundaries in
  `docs/COORDINATION.md`.
- **Model policy per kickoff** (table in `docs/COORDINATION.md`): Fable =
  planning/review only; Sonnet = standard feature work; stronger models only
  for genuinely hard problems; cheaper for mechanical work.
- **Closing ritual (every session, before wrap-up):** update this file, then
  append a done/next/context handoff prompt to `docs/HANDOFF.md`. The
  coordinator's review loop flags any session that wrapped without both.
- Coordinator reviews land under `## Coordinator review` in each
  `docs/phases/ws*-report.md`; merges to `main` go through the coordinator.

## Where things live

| What | Where |
|---|---|
| Architecture + constraints | `docs/ARCHITECTURE.md` |
| Wire/data contract (v1.0) | `docs/DATA-CONTRACT.md` |
| Decision log | `docs/DECISIONS.md` |
| Process, boundaries, model policy | `docs/COORDINATION.md` |
| Per-workstream specs + reports (incl. reviews) | `docs/phases/` |
| Remaining cloud/provider phases | `docs/phases/cloud-roadmap.md` |
| Session handoffs (next-session prompts) | `docs/HANDOFF.md` |
| Backend wipe SQL | `scripts/db-wipe.sql` |
| Pre-pivot app (auth/DB/BYOK) | branch `backup/pre-rewrite` / tag `backup-pre-rewrite` |
