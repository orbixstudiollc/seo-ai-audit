# SK3 — Agent orchestrator + hub/persistence (phase report)

Branch: `wsp-sk3-orchestrator` (two parallel Sonnet worktree agents +
coordinator adversarial review, per the approved plan — this phase's review
pass replaces the old Opus-builder designation).

## What shipped

**Backend (sk3-be):** `/api/audit/agent` — POST streams §9 events
(planOnly dry run = zero-write zero-spend; full run: deterministic
business-type detection ported from claude-seo's signal table → cap-enforced
plan (AGENT_MAX_SKILLS=8, AGENT_MAX_RUN_USD=0.25, wall-clock 180s) → inline
free skills via the SK1 modules → paid via runPaidSkill → technical-crawl
handoff via the technical-audit helper composition → rollup always → done);
GET ?runId= lazily reconciles pending tasks into a rebuilt rollup.
`agent_runs` migration (RLS zero-grant + full claim-RPC recreation —
byte-diffed clean by the reviewer). `GET /api/skills/technical-crawl?id=`
(the §8 polling adapter SK2 flagged as missing). 42 new tests.

**Frontend (sk3-fe):** SavedAgentReport + history mode "agent" (validators
strict), AgentAuditRunner persistence (partial→complete upgrade as pending
tasks resolve), SavedReportClient agent branch (reopen resolves + re-saves),
ShareLinkButton on agent reports, SharedReportView/DashboardClient/burndown
ripple branches, hub "Run agent audit" button + HUB_SKILL_IDS panel mounts,
Agent radio un-gated. 12 unit + 3 e2e tests.

## Evidence

lint ✓ · typecheck ✓ · unit **675/675** (was 620) · build ✓ · e2e **56/56**
(was 54).

## Adversarial review (coordinator-mandated for this phase)

Verdict WARNING: 0 CRITICAL, 2 HIGH, 1 MEDIUM. Spend-abuse, SSRF,
migration correctness, §9 ordering, and the FE union-ripple all held up
under adversarial reasoning ("areas confirmed clean" with evidence).

- **[HIGH, fixed] `runAgent` unguarded past the fetch** — a throw in
  computeParsedDocument/detection/DB/rollup closed the stream with no
  agent:error and left the run row stuck "running" forever. Fixed: the
  post-fetch body is wrapped; any throw emits agent:error (then nothing,
  per §9) and terminalizes the row (update if inserted, failed insert if
  not), with the status write itself shielded.
- **[HIGH, fixed] wall-clock-skipped skills stranded as "Queued"** — the
  server persisted skips but never told the client; rows stayed "planned"
  forever, live and in every saved snapshot. Fixed at both ends: the server
  now emits terminal skill-done events (failed task) for skips, and the
  reducer maps a failed task to a failed row (which also makes the view's
  per-row error branch reachable for ordinary inline failures — previously
  dead code). Regression tests at both levels.
- **[MEDIUM, accepted residual]** paid-skill fingerprint dedup weakens when
  a NEW full audit changes the host's latest audit id (fresh idempotency
  key → fresh spend). Bounded by the F2 per-owner/global daily caps; noted,
  not fixed — a stable per-host ledger id is a future refinement.
- Informational: the handoff's attach-failure path inherits a latent gap
  byte-for-byte from the technical-audit route (pre-existing, not this
  diff); tracked for a joint fix if it ever fires.

## Ops (deploy prerequisites for this wave)

1. Apply `supabase/migrations/202607210007_agent_runs.sql` before deploy.
2. Optional envs: AGENT_MAX_SKILLS / AGENT_MAX_RUN_USD / AGENT_WALL_CLOCK_MS
   (safe defaults baked in).
3. Registry `enabled` flags for the 9 skills flip only after per-skill live
   smokes post-deploy.
