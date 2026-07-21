# SK2 — Paid DataForSEO skills + agent-mode UI (phase report)

Branch: `wsp-sk2-paid-agent-ui` (two parallel Sonnet worktree agents,
disjoint ownership, zero converge conflicts).

## What shipped

**Backend (sk2-be):** `lib/dataforseo/{serp,keywords,labs,backlinks}.ts`
(live endpoints, typed normalizers, row caps, cost capture) over the
existing transport (whose private helpers were exported, not forked);
`lib/skills/paidSkillRunner.ts` — the reserve→collide→call→settle body
(SK3's orchestrator calls it directly, no HTTP self-calls); four
budget-gated routes mirroring technical-audit's gate order; additive
`taskById` in taskStore. skillId rides inside the persisted `request` JSON
(no schema change), and each GET guards cross-skill task-id mixups. 33 new
tests incl. budget-denied / collision / provider-throw / reuse paths.

**Frontend (sk2-fe):** `parseAgentFrame`, `useAgentStream` (reducer
mirroring useSiteAuditStream; 8 unit replays), `AgentReportView` (confirm
gate with server-computed est total, progress rows in the house glyph
vocabulary, handoff rows embedding `SkillPanel initialTaskId`, rollup via
ActionPlanPanel, per-kind error banners), `AgentAuditRunner` (+ TODO(SK3)
persistence marker), `/audit/agent` page, third "Agent" mode on the entry
form (NODE_ENV-gated until SK3), dev-page replay sections. e2e: happy path
(asserts zero /api/skills/* calls before confirm), budget_exceeded, axe +
320px.

## Evidence

lint ✓ · typecheck ✓ · unit **620/620** (was 573) · build ✓ · e2e **54/54**
(was 51).

## Accepted deviations

- FE touched `registry.tsx` (+ `TechnicalCrawlResult.tsx`) outside its set:
  required so the handoff row's embedded SkillPanel renders at all
  (unregistered ids render null). Defensive untyped renderer until the
  technical-crawl §8.1 payload lands.
- FE fixed a real a11y bug: the dev page originally mounted a live-fetching
  SkillPanel from replayed mock state (contract violation + wb-skeleton
  contrast failure) — resolved the pending row in the replay instead.
- BE: en/US locale fixed for serp/keywords/labs (`ponytail:` upgrade path —
  thread locale through SkillScope).

## Carry-forward for SK3 (blocking notes)

1. **`GET /api/skills/technical-crawl?id=` does not exist.** The handoff
   row polls it. SK3 must land that GET (mapping provider_tasks rows from
   the technical-audit pathway into the SkillTask envelope) or the real
   agent run's handoff never resolves. The e2e only mocked it.
2. `runPaidSkill` assumes synchronous /live/ endpoints — do NOT point it at
   the async on-page crawl; use the existing technical-audit helpers for
   the handoff start.
3. `ledgerAuditId` must be a real owned `audit_runs.id` (FK).
4. Registry `technical-crawl` is `enabled: true` but not in HUB_SKILL_IDS —
   fine (panel only ever mounts via initialTaskId), revisit at SK3.

## Coordinator review

Seams compiled clean at converge; both agents' fast-forward-of-main was the
correct stale-worktree remedy and was reported, not hidden. Registry flags
for the four paid skills stay `enabled: false` until the SK2 deploy smoke
verifies each live route + ledger actuals. Verdict: merge.
