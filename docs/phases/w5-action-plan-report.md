# W5-ACTION-PLAN — phase report

Branch: `wsp-action-plan`. Spec: kickoff prompt in `docs/HANDOFF.md`
(2026-07-20 coordinator entry) + DATA-CONTRACT §10.

> Unusual provenance, recorded per RULE B: an executor session built ~95% of
> this workstream, then stalled without committing (silent >3h, all files
> last written 17:17). The coordinator checkpoint-committed the work
> (`wip(w5)` commit), verified it, fixed one unrelated repo-hygiene issue,
> and completed the wrap-up on the user's "skip codex, continue step by
> step" instruction.

## What shipped

- `lib/skills/actionPlan.ts` (348 lines) — pure-TS synthesizer per
  DATA-CONTRACT §10: maps `AuditFindings` (blockers/question gaps), lens
  `capReason`s (a capped lens is a critical finding), site rollup
  `commonFindings`/`worstPages`, and DataForSEO on-page `issueKeys` (typed
  severity/effort table for ~20 known keys) into a severity-sorted
  `ActionPlan` — `MAX_ACTION_ITEMS = 50`, urls bounded, effort-tagged. No
  LLM calls, no new providers, no new dependencies.
- `lib/skills/actionPlan.test.ts` — 15 unit tests (severity ordering, caps,
  dedupe, empty inputs, issue-key mapping, url bounding).
- `app/components/audit/ActionPlanPanel.tsx` — report section composing the
  existing `Card` + severity CSS tokens (same vars as `SeverityChip`); text
  labels always paired with glyphs; positive empty state; renders nothing
  until a plan exists (progressive posture).
- Wiring: `AuditReportView.tsx` (single-page report), `SiteAuditReportView`
  + `SiteReportActions` (whole-site report), `lib/export/report.ts` (action
  plan included in exports), `test/e2e/mock-report.spec.ts` extended.
- Repo hygiene found during gates: stale pre-pivot `.vercel/output` build
  artifacts (old auth-era functions) broke `pnpm lint` with 71 errors in
  generated launchers — moved out and `.vercel/**` added to
  `eslint.config.mjs` ignores so a local `vercel build` can't redden lint
  again.

## Contract conformance (§10)

`ActionSeverity`/`ActionItem`/`ActionPlan` shapes match the contract
exactly; items ≤50, severity-sorted, `source` traces each item to a signal
id / lens cap / issueKey; verified by unit tests + coordinator review.

## Evidence

- `pnpm lint` — clean (after the `.vercel` ignore fix)
- `pnpm typecheck` — clean
- `pnpm test` — 39 files, **288/288 passed** (was 273 before W5)
- `pnpm build` — compiled, all routes generated
- `pnpm e2e` — **25/25 passed** after two wrap-up fixes:
  1. `ActionPlanPanel`'s title rendered as the `Card` label `<span>`, but the
     repo's e2e/a11y pattern asserts heading roles — added a `labelAs` prop to
     the shared `Card` (default `span`, backwards-compatible) and the panel
     passes `labelAs="h3"`. Future SkillPanel sections get the same
     accessible-heading option for free.
  2. Pre-existing `site-audit.spec.ts` asserted `getByText("Worst pages")`,
     which the action plan's item prose now also matches (strict-mode
     collision) — scoped those assertions to `getByRole("heading", …)`.

## Coordinator review

Reviewed by the coordinator (who also performed the wrap-up): §10
conformance exact; design guardrails held (no new colors/status vocab, glyph
markers paired with text labels — acceptable under the SeverityChip
precedent); synthesizer is pure and bounded. All gates green. Verdict:
**merge**.
