# F2-BUDGET — phase report

Branch: `wsp-budget`. Spec: kickoff prompt in `docs/HANDOFF.md` + D-016 +
DATA-CONTRACT §8. Built step-by-step by the coordinator session per the
user's "skip codex" instruction.

## What shipped

- `supabase/migrations/202607200004_spend_gate.sql` —
  1. `provider_tasks.request_fingerprint` (default `''`) + unique index
     rebuilt as `(owner_hash, audit_id, provider, request_fingerprint)`;
     existing on-page rows/behavior unchanged, per-call providers (W1-DFS)
     get many-tasks-per-audit idempotency.
  2. `reserve_spend(...)` security-definer RPC: atomic (advisory-lock
     serialized) rolling-24h spend check per owner AND globally against
     app-supplied caps, inserting the reservation ledger row
     (`estimated_cost_usd` set, actual null) on allow. `cancel_spend(...)`
     removes an unsettled reservation only.
  3. `claim_anonymous_workspace` updated IN THE SAME migration to carry
     `request_fingerprint` and target the new conflict key (the
     silently-breaks-account-linking hazard the plan flagged).
- `lib/providers/budget.ts` — `budgetCaps()` (env
  `PROVIDER_OWNER_DAILY_USD`/`PROVIDER_GLOBAL_DAILY_USD`, defaults 1/10,
  `0` = kill switch, garbage → defaults), `reserveSpend()` (deny-closed on
  RPC error), `cancelSpend()`.
- `lib/providers/taskStore.ts` — reserve→attach/release flow extracted from
  the technical-audit route, generalized on provider+fingerprint.
  **Race fix**: `releaseReservation` deletes by the reservation row's
  primary key; the old cleanup deleted every NULL-provider_task_id row for
  the triple, which could destroy a concurrent caller's fresh reservation
  and let a second paid task start.
- `app/api/technical-audit/route.ts` — now per-IP rate-limited **before any
  parsing or DB work** (3/min, 10/day — it previously had NO rate limit on
  the only endpoint that spends provider money), budget-gated via
  `reserveSpend` before reserving (429 `budget_exceeded` per §8's error
  vocabulary), and refactored onto taskStore. Concurrent-reservation loser
  now cancels its own budget reservation and reuses the winner's task.
  Response shapes unchanged — all pre-existing tests pass unmodified in
  their assertions.
- `.env.example` — the two cap vars documented.
- Tests: `lib/providers/budget.test.ts` (7 — caps parsing incl. kill
  switch, RPC passthrough, allow/deny/deny-closed mapping, cancel), route
  suite extended (+3: 429 before DB, budget_exceeded before provider,
  release-by-primary-key + cancel on provider-start failure).

## Deviations from kickoff

- **No `budgets` table.** Caps live in env and are passed into the RPC per
  call — the operator tunes them in Vercel without a deploy, and a config
  table with one row is machinery without a customer. Revisit only if
  per-owner custom budgets become a feature.
- Settlement reuses the route's existing `ensureUsageLedger` upsert (its
  conflict key matches the reservation row, so filling `actual_cost_usd`
  IS the settle step) — no separate `settle_spend` RPC needed.

## Evidence

- `pnpm lint` clean · `pnpm typecheck` clean
- `pnpm test` — 40 files, **298/298** (was 288)
- `pnpm build` — compiled · `pnpm e2e` — **25/25**

## ⚠️ Deploy order (operator action)

**Apply the migration BEFORE deploying this code.** The migration is
backwards-compatible with the live code (new column defaults to `''`, same
uniqueness semantics), but the new code is deny-closed: without
`reserve_spend` in the database it refuses paid crawls (503). Run
`supabase/migrations/202607200004_spend_gate.sql` in the Supabase SQL
editor first, then deploy.

## Coordinator review

Self-reviewed under the standing checklist: §8 error vocabulary honored
(`budget_exceeded`, `rate_limit`), deny-closed posture on every failure
path, no key/token material logged, claim-RPC and index changed atomically,
route behavior byte-compatible for existing consumers. Verdict: **merge**;
production validation of the RPC (one real crawl + a forced cap denial)
after the migration is applied.
