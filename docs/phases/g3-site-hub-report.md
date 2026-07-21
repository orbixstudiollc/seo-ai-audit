# G3 — Site hub (phase report)

Branch: `wsp-g3-site-hub`. Plan: `.claude/plan/multi-agent-growth-execution.md`
(G3 row) + `~/.claude/plans/shimmying-launching-elephant.md`. Built
step-by-step by the coordinator session, scope adjusted against codebase
reality before implementation (D-022).

## Scope decision

The growth plan's G3 text called for mounting a generalized `SkillPanel`
(W3-SHELL) and an agent-orchestrator "run everything" button (W7-AGENT) on
the hub. Neither exists in the codebase — both are DATA-CONTRACT §8/§9 spec
text only, with W7-AGENT explicitly dependent on W3-SHELL in the platform
plan. Building either against one caller would be a speculative framework.
Shipped instead: everything in G3 that composes pieces already real and
already shipped — see D-022.

## What shipped

- **`app/site/[host]/page.tsx` + `SiteHubClient`** — one domain's growth
  trend, tracked-site toggle, current action plan, technical crawl panel,
  and audit history in one page. Zero new API routes: reuses
  `/api/tracked-sites`, `/api/growth`, and the existing report-loading path
  (`loadAuditReport`/`loadCloudAuditReport`) exactly as `/report/[id]`
  already does.
- **`lib/growth/burndown.ts`** — the "progress metric" from the growth plan,
  built two ways: `domainIssueTrend` is a zero-new-persistence approximation
  (issue counts already stored in `AuditHistoryRecord.details`, chronological,
  rendered on the existing `TrendSparkline`); `diffActionPlans` is an EXACT
  item-id diff between the two most-recently-loaded full reports, giving a
  precise "N resolved · M new since previous audit" caption without a new
  migration. 8 unit tests.
- **Diff correctness**: the plan shown to the user (`currentPlan`) includes
  live `technicalPages` once the crawl panel loads them; the plan used for
  the diff (`currentPlanForDiff`) never includes them, so mounting the crawl
  panel can never masquerade as "new issues found" in the comparison.
- **`app/hooks/useMergedHistory.ts`** — the local+cloud history hydration
  effect extracted verbatim from G1's `GrowthOverview` (real duplication:
  the hub needs the identical logic) — `GrowthOverview` now consumes it too,
  behavior unchanged.
- **`app/components/growth/LensScoreGrid.tsx`** — the 4-lens score strip
  extracted from `SiteGrowthCard` the same way, reused by both.
- `SiteGrowthCard`'s domain heading now links to `/site/<domain>`;
  `DeltaChip` exported for reuse on the hub.
- e2e: 5 new specs (golden path, empty state, dashboard-card link, axe,
  320px) in `test/e2e/site-hub.spec.ts`.

## Evidence

lint ✓ · typecheck ✓ · unit **375/375** (was 366) · build ✓ · e2e **46/46**
(was 41).

## Coordinator review

Independent adversarial code-reviewer agent pass before merge. Verdict:
WARNING (1 HIGH, 3 MEDIUM) — all four fixed, re-gated green, no CRITICAL,
no LOW noise padding the report.

- **[HIGH, fixed] `diffActionPlans` under-counted because `ActionItem.id`
  was positional** (`common-${i}`, `blocker-${i}`, `gap-${i}` in
  `lib/skills/actionPlan.ts`), not content-derived — and `commonFindings` is
  sorted by count on every audit, so "index 0" names a different issue each
  time. Two audits with completely unrelated findings could land on the same
  id and get silently excluded from both the resolved and introduced counts.
  Fixed with a `stableId(prefix, text)` helper (slugified content, not
  index) for all three positional sites. Regression test added at both
  levels: a unit test running the exact scenario through real
  `actionPlanForSite` output (not hand-built plans with pre-distinct ids),
  and an e2e assertion on the rendered "N resolved · M new" caption — neither
  existed before, so the bug had zero coverage at either level.
- **[MEDIUM, fixed] `technicalPages` could pair with a newer `latestReport`**
  during the guaranteed local→cloud history hydration swap, briefly mixing
  crawl data from one report with rollup data from another. Fixed: reset to
  `null` in the same effect that loads a new `latestReport`, and the panel is
  now `key`-ed by report id for a clean remount.
- **[MEDIUM, fixed] `dailySeries` fetch had no cancellation guard**, unlike
  the file's other three async effects — an out-of-order resolution across
  two different tracked urls for one domain could overwrite it with stale
  data with no self-correction. Fixed: cleared immediately whenever
  `trackUrl` changes, before the (possibly skipped) fetch.
- **[MEDIUM, fixed] the diff/burndown feature had no test verifying its own
  headline output** — closed by the same regression tests as the HIGH fix.

Also verified by the reviewer as correct, unchanged: the current-plan vs.
diff-plan split (`technicalPages` never leaks into the diff), the
`useMergedHistory`/`LensScoreGrid` extractions (byte-for-byte
behavior-preserving vs. the pre-refactor originals), no new trust boundary
(`host` param only ever string-compared or JSX-interpolated, React-escaped),
design-token consistency, and graceful degradation for single-audit domains
and records with no `details` yet.

Guardrails held: no new API routes, no new migrations.
