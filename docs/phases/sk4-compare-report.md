# SK4 — Competitor compare + wave wrap (phase report)

Branch: worktree merge `f7ba1c3` (one Sonnet agent). Final phase of the
skills + agent-mode wave (SK0–SK4, D-023).

## What shipped

`lib/skills/compare.ts` + `app/api/skills/compare/route.ts`: keyword →
one metered SERP call (via runPaidSkill, skillId "compare") → top-≤3
distinct-domain competitors (own host dropped) → per-competitor page
audits under the bulk-style timeout race (concurrency 2) → side-by-side
vs the owner's stored scores (reused when present, one audit otherwise).
Failed page audits degrade to null scores, never abort. The full result
overwrites the SERP provider_tasks row, so an identical repeat reuses
EVERYTHING at $0. Route streams two route-local SSE frames
(compare:progress/compare:done — documented as non-§9). Route-local
compareGate (2/min 5/day, tighter than the shared paid gate — flagged
deviation, accepted: parameterizing the shared gate for one caller was
the larger change). 18 new tests; the agent caught and fixed a real bug
while writing them (a late rewrite-stage error discarding already-captured
scores).

## Evidence

lint ✓ · typecheck ✓ · unit **693/693** · build ✓ · e2e **56/56**.

## Wave live validation (D-007, 2026-07-21)

- Migration `202607210007_agent_runs.sql` applied to production via the
  Supabase connector; RLS + zero-grant + single claim-RPC verified by
  probe.
- $0 skills: schema + ai-access ran live against a real site — correct
  §8.1 payloads, costUsd 0.
- Agent planOnly dry run live: `agent:plan` → `agent:done`, businessType
  detected, paid skills correctly dropped for an owner with no prior
  audit, zero spend, zero writes.
- Paid skills live: backlinks ($0.024 actual vs $0.03 reserve), serp
  ($0.004 vs $0.01), labs ($0.024) — usage_ledger shows exactly one row
  per call with estimates settled to actuals; an identical repeat POST
  returned `reused: true` with the same task id and NO new ledger row
  (fingerprint idempotency proven in production).
- /dev/mock-skills 404s in production (NODE_ENV gate); core pages 200.
- Registry flags flipped for the 7 verified skills
  (schema/sitemap/hreflang/images/ai-access/backlinks/labs); serp/keywords
  stay off pending input UX; compare off pending its own live smoke.

## Residuals (accepted, tracked)

- `GET /api/skills/technical-crawl?id=<non-uuid>` returns 503
  cloud_read_failed instead of 404 (uuid-cast error at the DB layer);
  well-formed unknown ids 404 correctly. LOW, cosmetic.
- Compare registry flag off until a live smoke on the deployed route.
- SK3's MEDIUM residual (fingerprint dedup weakens across new audits of
  the same host) and the inherited technical-audit attach-failure gap —
  see sk3-orchestrator-report.md.
