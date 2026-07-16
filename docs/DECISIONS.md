# Decision log

Append-only. Format: `D-###  date  decision — rationale`. Sessions may
propose; the coordinator records.

- **D-001** 2026-07-17 — **v1 has NO auth and NO database.** Product decision
  by the user: open, anonymous, low-friction tool. Auth/persistence deferred
  to Phase 5. Pre-pivot app preserved at `backup/pre-rewrite` /
  `backup-pre-rewrite` (commit `7897e32`).
- **D-002** 2026-07-17 — **Server-side LLM key replaces BYOK.** Anonymous
  users can't bring keys. `ANTHROPIC_API_KEY` from Vercel env;
  `AUDIT_TEST_MOCK=1` for tests. Per-user encrypted key storage deleted.
- **D-003** 2026-07-17 — **The scoring engine is reused wholesale, frozen.**
  `packages/scoring` (18 signals, 4 lenses, caps, versioning) survives the
  pivot untouched; it has no auth/DB coupling. Rebuilding it would be waste.
- **D-004** 2026-07-17 — **SSE stream contract adapted for anonymity** (see
  DATA-CONTRACT v1.0): new first event `meta` (page info previously came from
  the DB document row); `done` loses `auditId`; error kinds swap BYOK set
  (`no_key`/`invalid_key`/`already_running`) for fetch set
  (`invalid_url`/`fetch_failed`/`unsupported_content`).
- **D-005** 2026-07-17 — **No det-only degraded mode in v1.** If the server
  key is missing, that's a `server` error, not a partial audit. Cuts a whole
  matrix of half-rendered states; revisit only with evidence of need.
- **D-006** 2026-07-17 — **Share link = re-run.** `/audit?url=…` is the share
  format; opening it re-runs the audit (stateless). Persistent share pages
  need a DB → Phase 5.
- **D-007** 2026-07-17 — **Deploy verification must hit the real URL.** The
  pre-pivot deployment reported READY while serving 404s (Vercel framework
  preset was null → wrong builder; fixed by setting framework `nextjs`), and
  later the site timed out entirely. Every deploy check curls the production
  URL and asserts on the HTML body.
- **D-008** 2026-07-17 — **Rate limiting is per-IP, in-memory, per-instance**
  for v1 (adapting `lib/audit/ratelimit.ts`). Good enough for a single-region
  hobby deployment; a shared store (Upstash/etc.) is a Phase-4+ concern and
  needs coordinator sign-off (new dependency + external service).
- **D-009** 2026-07-17 — **Backend wipe = drop schema public** (see
  `scripts/db-wipe.sql`). All 7 pre-pivot tables verified empty on 2026-07-17
  before the decision; DDL recoverable from `backup/pre-rewrite`. Executed by
  the user in the Supabase SQL editor (connection string is a write-only
  sensitive var, unreadable from tooling — by design).
- **D-010** 2026-07-17 — **Coordinator/executor model.** Fable session plans,
  writes specs/contracts, reviews diffs periodically; separate coding-model
  sessions implement WS1/WS2/WS3 in parallel against DATA-CONTRACT v1.0.
  Every session documents as it goes under `docs/` (RULE B).
