# Multi-Agent Execution Plan — Growth Program G2→G5 with Design-Sync

Requested via `/multi-workflow` ("plan for multiple agents") + the standing
directive "more agent workflows, design sync all over the process".
Note: the `ccg-workflow` Codex/Gemini runtime is NOT installed
(`~/.claude/bin/codeagent-wrapper` absent — `npx ccg-workflow` would enable
the literal dual-model flow). This plan implements the same intent with the
native machinery that already proved itself here: the **Workflow tool**
(deterministic fan-out), **Agent tool** (worktree-isolated builders), and
the **DesignSync tool** (claude.ai design-system project sync).

## Operating shape — every phase runs the same 5-stage pipeline

```
Stage 0  CONTRACT (coordinator, inline)
         DATA-CONTRACT addendum + type stubs + fixtures. Frozen before agents start.

Stage 1  BUILD (2–3 parallel worktree agents, disjoint file ownership)
         Each agent gets: scope, owned files, fixtures, gates to run, and
         "no new tokens/primitives" design guardrail. Worktree isolation
         (isolation: "worktree") so parallel mutation can't collide.

Stage 2  CONVERGE (coordinator, inline)
         Merge agent branches in dependency order, run full gates
         (lint · typecheck · unit · build · e2e).

Stage 3  VERIFY (Workflow: parallel reviewer agents, adversarial)
         a. security reviewer — abuse/SSRF/spend paths (Opus-effort)
         b. DESIGN-SYNC reviewer — every changed component vs the design
            system: tokens only, existing primitives, glyph+text pairing,
            axe/contrast, 320–1440 (this is the "design sync all over the
            process" gate)
         c. test-coverage reviewer — behavioral gaps vs the phase spec
         Findings → coordinator fixes → re-gate. Verdict recorded in the
         phase report.

Stage 4  SHIP + SYNC (coordinator)
         Ritual (report, PROJECT-STATUS, HANDOFF) → merge to main → user
         pushes → deploy → D-007 verify → **DesignSync upload**: changed
         component previews pushed to the claude.ai design-system project so
         the design pane always mirrors production (needs one-time
         /design-login authorization — first upload will prompt).
```

## Phase → agent decomposition

### G2 — tracked sites + daily DET snapshots (next up)
| Agent | Scope (owned files) | Notes |
|---|---|---|
| g2-db | migration `202607200005_growth_tracking.sql` (tables + RLS + claim-RPC blocks) + SQL review vs 202607200004 pattern | no app code |
| g2-api | `app/api/tracked-sites`, `app/api/cron/snapshots`, `app/api/growth`, `lib/growth/collect.ts` (+ tests, `vercel.json`) | builds against g2-db's SQL as spec; CRON_SECRET timing-safe; ssrfGuard; CAS claim |
| g2-ui | track-toggles on growth cards/reports, snapshot-series wiring into `TrendSparkline`, content-changed badge (+ e2e) | against fixture series until g2-api merges |
Verify stage adds: cron double-fire simulation, budget/abuse review (mintable owners × cron), migration-order check (F2 migration must be applied first).

### G3 — skills + agent runs per site hub
g3-hub (`/site/[host]` page + timeline), g3-shell (SkillPanel generalization from TechnicalSeoPanel + /dev/mock-skills), g3-burndown (plan-item fingerprints + burndown line). Design-sync gate is critical here — this phase mints the SkillPanel pattern every future skill copies.

### G4 — GSC/GA4 daily ingestion
g4-oauth (W2-GOOGLE vault — single agent, security-critical, high effort),
then g4-data (properties + query/report routes + caching) ∥ g4-ui (outcome
lines + insights lists). Ops prerequisite: Google verification (user).

### G5 — ads panels
g5-google-ads (scope extension on the same OAuth) ∥ g5-meta (separate OAuth
track) ∥ g5-ui. Spec written after G4 ships.

## Rules that keep multi-agent safe here

1. Contract/fixtures frozen BEFORE fan-out (proved by WS1–WS4: zero merge
   conflicts when ownership is disjoint and shapes are pre-agreed).
2. Agents never push; the coordinator merges in dependency order and owns
   gates. One agent stalling never blocks siblings (checkpoint-commit
   protocol from the W5 incident).
3. Reviewer agents are independent of builder agents (fresh context,
   adversarial prompts) — no agent reviews its own work.
4. Design-sync appears TWICE per phase: as a verify-stage reviewer (blocks
   merge) and as a post-ship DesignSync upload (keeps the claude.ai design
   pane current).
5. Every stage's outputs land in the phase report as evidence; closing
   ritual unchanged.

## Immediate next step

Run G2 under this pipeline: Stage 0 (DATA-CONTRACT §13 growth shapes —
coordinator) then launch g2-db ∥ g2-api ∥ g2-ui as worktree agents.
