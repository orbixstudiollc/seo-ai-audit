# SK1 — Deterministic skills + panel shell (phase report)

Branch: `wsp-sk1-skills` (converged from two parallel Sonnet worktree agents,
disjoint file ownership, per the approved SK0–SK4 plan). SK0 contract prep
(`11f60d2`) preceded it: DATA-CONTRACT v1.5 (`ai-access` SkillId, §8.1 typed
results, `planOnly`), `lib/skills/types.ts`, `extraItems` seam, D-023.

## What shipped

**Backend (sk1-be):** five $0 deterministic skill backends ported from the
claude-seo v2.2.4 rubrics, complete-inline per §8 (no persistence):
`lib/skills/{schema,sitemap,hreflang,images,aiAccess}.ts` + routes at
`app/api/skills/<skillId>/route.ts` + shared `routeHelpers.ts` (skillGate,
completeTask/failedTask, toSkillError). All fetches through the existing
SSRF stack (`fetchArticle`/`safeFetchText`) — zero new fetchers. 156 new
unit tests (table-driven rubric rules + route gate-order).

**Frontend (sk1-fe):** the W3-SHELL surface — `SkillPanelView` (pure
lifecycle shell) + `SkillPanel` container (generalizes TechnicalSeoPanel's
poll loop; `initialTaskId` = handoff/reopen mode), `StatGrid`, 10 typed
result renderers, `SKILL_REGISTRY` (all `enabled: false` until routes are
verified live), per-skill §8 mocks, `mockAgentRun` event scripts, and the
`/dev/mock-skills` design-gate page (axe + 320px + keyboard e2e). The 320px
spec caught a real flex-sizing overflow (auto-margin main + unwrappable
`<pre>`); root-caused and fixed with the house `min-w-0` pattern.

## Evidence

lint ✓ · typecheck ✓ · unit **573/573** (was 375) · build ✓ · e2e **51/51**
(was 46). Zero cross-agent file conflicts at converge (ownership held).

## Notable agent deviations (accepted)

- `too_large` → `unsupported_content` (matches existing `mapImportError`).
- `sitemap.ts` locally duplicates ~15 lines of discovery XML parsing (the
  discovery helper hardcodes `/sitemap.xml` and was outside ownership).
- Image "oversized" is approximated via byte-capped GET (safeFetchText has
  no HEAD) — `ponytail:` comment with upgrade path.
- FE agent fast-forward-merged main into its worktree (stale base predated
  SK0) — additive, no conflicts, correctly reported.

## Coordinator review

Seam check: BE result shapes and FE renderers both type against
`lib/skills/types.ts` §8.1 — tsc enforces the contract; converge compiled
clean on first merge. Registry stays all-disabled until SK-phase deploy
smokes verify each route live (flag-flip per skill is the integration).
Next: SK2 (paid DFS skills ∥ agent-mode UI).
