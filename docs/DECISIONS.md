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
- **D-011** 2026-07-20 — **Supabase becomes the durable audit store without
  adding accounts.** The user explicitly reprioritized persistence as Phase 1.
  A random 256-bit device token is stored in the browser, hashed server-side,
  and used to partition records. Supabase tables have RLS enabled and no public
  policies; only server routes holding `SUPABASE_SECRET_KEY` can access them.
  Browser storage remains an offline fallback and migration source. Account
  auth/cross-device recovery remains a later phase.
- **D-012** 2026-07-20 — **Resume all remaining phases.** The user's explicit
  instruction to complete all phases authorizes the previously deferred work.
  Cloud Phase 2 adds an opt-in DataForSEO OnPage crawl to saved whole-site
  reports with a 500-page cap, conservative cost settings, durable task state,
  and an actual-cost ledger. Phase 5 then adds account identity and
  cross-device recovery while preserving anonymous auditing.
- **D-013** 2026-07-20 — **Account recovery stays server-owned and optional.**
  Supabase Auth email links verify identity, but browser roles retain no table
  access. Next.js verifies bearer tokens with Supabase, derives an opaque
  account owner hash, and uses one restricted `security definer` RPC to claim
  an anonymous device workspace atomically. Signing out returns requests to
  device ownership; auditing never requires registration.
- **D-014** 2026-07-20 — **Skill triage for the SEO-team platform.** From the
  claude-seo v2.2.0 inventory (installed locally as reference): BUILD action
  plan, drift, schema validate/generate, sitemap validate, hreflang, image
  checks, SXO, competitor compare, topic clusters, content briefs,
  keyword/backlink panels, GSC/GA4 insights. ALREADY COVERED: GEO, E-E-A-T,
  page audit, schema detection, technical crawl. DEFER: local, maps,
  e-commerce, programmatic, FLOW, image-gen, IndexNow. Deferred items need a
  new decision, not enthusiasm, to enter scope. Plan:
  `.claude/plan/seo-team-platform.md`; contract: DATA-CONTRACT §8–§12.
- **D-015** 2026-07-20 — **Google integrations are account-gated; tokens are
  app-encrypted.** OAuth refresh tokens never bind to anonymous device tokens
  (orphaned + unrevokable when localStorage clears; mintable tokens defeat
  caps). Connect flows require the verified bearer path (D-013). Tokens:
  AES-256-GCM with a dedicated server env key, server-only RLS tables,
  revoke-at-Google on disconnect, purge endpoint, never logged/serialized.
  Consent-screen verification (sensitive scopes) filed as week-1 ops.
- **D-016** 2026-07-20 — **No new paid endpoint before the spend gate.**
  usage_ledger becomes enforcing: budgets + reserve_spend/settle RPC (per-owner
  AND global daily caps), request-fingerprint idempotency on provider_tasks,
  per-IP rate limit added to /api/technical-audit (it had none). Supersedes
  D-008 for paid routes; D-008 stands for free ones.
- **D-017** 2026-07-20 — **Agent mode runs as durable hybrid, not one stream.**
  Fast skills inline in SSE; slow/provider skills hand off to polled
  SkillTasks; run state persists (agent_runs); estimated cost shown before
  fan-out; per-run caps on skills/USD/wall-clock. Rationale: bulk already
  needs a 240s budget inside maxDuration=300.
- **D-018** 2026-07-20 — **scripts/db-wipe.sql deleted.** Written for the
  pre-D-011 stateless era and never executed; with Supabase now holding live
  production data (audit_runs, reports, ledger, Google tokens coming), a
  runnable full-schema wipe in the repo is pure hazard. Recoverable from git
  history if ever legitimately needed.
- **D-020** 2026-07-20 — **Tracked-site fairness + capacity.** The snapshot
  queue serves never-run sites LAST (existing sites' daily cadence survives
  registration floods from mintable owners) and tracked-site registration has
  a deployment-wide 500-site ceiling (durable control; per-owner caps alone
  cannot bound growth when owner tokens are free to mint). Residuals accepted
  and documented in docs/phases/g2-tracked-snapshots-report.md: the
  audit_required gate is UX-not-security (PUT /api/history bypass), and the
  account-claim merge may exceed the per-owner limit.
- **D-021** 2026-07-21 — **Share links are opt-in per report, not
  public-by-default.** "Store everything in Supabase so anyone can view from
  anywhere" is satisfied by (a) default-on cloud persistence of every run
  state — already live since Phase 1/D-011 — plus (b) `share_links`: a
  server-minted 128-bit hex token per report the owner explicitly shares,
  rendered read-only at public `/s/<token>` (noindex). Making all reports
  public-by-default would leak what users audit. Revocation = DELETE row;
  the link dies instantly.
- **D-022** 2026-07-21 — **G3 ships the site hub now; SkillPanel generalization
  and the agent orchestrator wait for their prerequisites.** The growth plan's
  G3 text assumed W3-SHELL (a generalized `SkillPanel`) and W7-AGENT (the
  "run everything" orchestrator) already existed to mount onto the site hub.
  Investigation confirmed neither exists anywhere in the codebase — both are
  still DATA-CONTRACT spec text (§8/§9) with zero implementation, and W7-AGENT
  is explicitly gated on W3-SHELL in the platform plan. Building either against
  a single caller (the hub) would be a speculative framework, not a feature.
  Shipped instead: `/site/[host]` composing pieces that DO exist today
  (growth series, tracked-site toggle, the action-plan synthesizer, the
  existing `TechnicalSeoPanel`) — zero new API routes, zero new migrations.
  SkillPanel and the orchestrator remain queued exactly as PROJECT-STATUS
  already listed them; this decision just records that G3-as-shipped is
  narrower than G3-as-planned, and why.
- **D-023** 2026-07-21 — **Skills + agent-mode wave (SK0–SK4) supersedes
  D-022's deferral.** The SkillPanel generalization and agent orchestrator
  now have a full wave behind them (10+ panel call sites, the orchestrator,
  the hub, saved agent reports), so building them is no longer speculative.
  Scope per the approved plan: W3-SHELL + W4-DET-SKILLS + W1-DFS (paid) +
  full W7 + W8 compare subset. Additive contract v1.5: `"ai-access"` SkillId
  (llms.txt/AI-crawler checks — `"sxo"` stays reserved for real SXO),
  §8.1 typed result payloads, `planOnly` request flag on the agent route.
  Drift skill stays deferred (G2 snapshots + G3 burndown cover it; revisit
  with §12 regressions). Model policy for this wave (user directive):
  Sonnet for ALL build agents; the orchestrator gets a coordinator
  adversarial review pass in lieu of an Opus builder. Business-type
  detection is deterministic (claude-seo's own signal table ported), not
  LLM classification.
