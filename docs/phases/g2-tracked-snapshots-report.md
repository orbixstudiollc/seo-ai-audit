# G2 — Tracked sites + daily DET snapshots (phase report)

Branch: `wsp-growth-2`. Contract: DATA-CONTRACT §13 (written first, per the
pipeline). Ran the full multi-agent pipeline from
`.claude/plan/multi-agent-growth-execution.md`:

- **Stage 0 (coordinator):** §13, migration `202607200005_growth_tracking.sql`
  (tables + RLS + claim-RPC updated atomically), `lib/growth/types.ts`.
- **Stage 1 (2 worktree build agents):** `g2-api` (tracked-sites routes,
  CRON_SECRET-gated collector, growth series route, vercel.json cron,
  38 tests) ∥ `g2-ui` (mock-first toggles, daily sparkline preference,
  changed badge, e2e incl. G1-fallback proof). Zero merge conflicts.
- **Stage 2 (converge):** merged + full gates green.
- **Stage 3 (verify — 3 adversarial reviewers):** security
  `changes-requested` (3), design `merge` (7 polish), coverage
  `changes-requested` (10). All actionable findings fixed:
  - **Starvation defense:** `dueSites` orders never-run sites LAST (existing
    sites keep daily cadence under registration floods) + a deployment-wide
    **500-site capacity gate** (503 `capacity`) since owner tokens are
    mintable and per-owner caps alone can't bound growth.
  - **Idempotent re-track:** owner count excludes the posted url — re-POST
    at the 10-site limit is 201, matching the route's stated contract.
  - **Midnight day-key:** the cron passes its single invocation `now` to
    every snapshot (no day-drift across UTC midnight).
  - **A11y/design:** `role="alert"` errors, ● failure glyph (▼ stays
    score-direction-only), pending copy, no Button font override, exact
    tracked-url title, caption/sparkline noun+count agree by construction,
    and a new "Also tracking (not in this browser's history)" card so
    orphan-tracked urls are visible and untrackable.
  - **Coverage (2 more worktree agents):** cron bounding (25-cap + deadline
    break via Date.now sequence), days-cap edges, changed-flag across
    error-day gaps, site-kind lens blending, producer-side det quantization,
    capacity/nulls-last regression pins, untrack + API-500-fallback + orphan
    e2e. Both agents report **zero production bugs found**.

## Accepted residuals (documented, not fixed here)

1. `audit_required` is bypassable via `PUT /api/history` fabricated records —
   it remains a UX gate, not a security boundary. Bounded by the capacity
   gate + SSRF guard + zero-spend cron; durable fix (server-attested audits
   or per-account quotas) belongs to the account phase.
2. `claim_anonymous_workspace` can merge device+account tracking above the
   10-site POST limit; the cron simply serves them and new adds still 409.
3. Per-IP POST limiting stays in-memory/per-instance (D-008); the capacity
   gate is the durable control.

## Evidence

lint ✓ · typecheck ✓ · unit **356/356** (45 files) · build ✓ · e2e **39/39**.
Agent gate outputs recorded in the workflow journals
(`wf_b6019834-3bd`, `wf_092ded34-bf7`, `wf_e2937059-20b`).

## Deploy order (operator)

Apply `202607200005_growth_tracking.sql` (after `202607200004`) and set
`CRON_SECRET` in Vercel BEFORE deploying this merge; the routes are
deny-closed without them. Vercel Cron (03:00 UTC daily) starts collecting
free DET snapshots the first night after deploy.

## Coordinator review

Pipeline held: contract-first fan-out produced zero conflicts; reviewers
caught real issues (starvation economics, SR contradiction, missing bounding
tests) that gates could not. Verdict: **merge**.
