# PROJECT-STATUS — SEO AI Audit v1

**The single canonical source of truth for this project.** Every session
updates this file before wrapping up (see the closing ritual in
`docs/COORDINATION.md`) and appends a handoff entry to `docs/HANDOFF.md`.
Detail lives in `docs/` (phases, contract, decisions); this file is the map.

Last updated: 2026-07-19 · by: release integration session · main @ `20f2b0c`

## Product

Open, anonymous, low-friction tool: paste a URL → streamed AI-search audit
(AEO / GEO / Citability / AI Overview scores + evidence-backed findings).
No account, no signup, no stored data. **Live:**
https://seo-ai-audit-pied.vercel.app

## Current status (one paragraph)

WS1–WS3, provider-flex, and WS4 are **done, integrated on `main`, and live in
production**. The product supports anonymous single-page and whole-site audits,
streamed per-page results and site rollups, pinned-IP SSRF protection, and
Anthropic or OpenAI-compatible providers. Release gates are green: lint,
typecheck, 222 unit/integration tests, production build, and 14 Playwright
journeys. Production was directly deployed and smoke-tested on 2026-07-19:
the whole-site selector and route are live, the bulk endpoint validates bad
input correctly, and the security headers, robots.txt, and llms.txt are present.
A real provider key is still required in Vercel for the seven LLM-rubric
signals; without it the deterministic phase completes and the app degrades
cleanly. Auth/persistence stays deferred (Phase 5), and the Supabase wipe SQL
is still awaiting the user.

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
| 8 | Phase 4 report features: export, share, schema output, local history | — | ⏸ parked (`docs/phases/later-phases.md`) |
| 9 | Phase 5 auth + persistence | restore from `backup/pre-rewrite` | ⏸ **deferred by product decision D-001** |

## Pending user actions

1. **AI key in Vercel** — set `ANTHROPIC_API_KEY`, or configure
   `AI_PROVIDER`+`AI_API_KEY`+`AI_MODEL`[+`AI_BASE_URL`] for a non-Anthropic
   provider (OpenRouter/zenmuz/Ollama/etc.). Until a key is set, production
   audits return the fetch/DET phases and error cleanly on the rubric phase.
2. **Supabase wipe** — run `scripts/db-wipe.sql` in the Supabase SQL editor
   (D-009; all 7 pre-pivot tables verified empty; also staged on branch
   `claude/reset-schema-permissions-wb2yex`).
3. Optional cleanup: delete stale `DATABASE_URL` / `BETTER_AUTH_*` /
   `ENCRYPTION_KEY` vars from Vercel (WS1 report, open question 1).

## Key decisions (full log: `docs/DECISIONS.md`)

- D-001 no auth / no DB in v1 (Phase 5 deferred); restore point
  `backup/pre-rewrite` = `7897e32`.
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
| Session handoffs (next-session prompts) | `docs/HANDOFF.md` |
| Backend wipe SQL | `scripts/db-wipe.sql` |
| Pre-pivot app (auth/DB/BYOK) | branch `backup/pre-rewrite` / tag `backup-pre-rewrite` |
