# WS3 (Results Dashboard UI) — phase report

> Filled in by the WS3 execution session as work proceeds (RULE B: document
> as you go). The coordinator appends reviews here.

## Status

- [x] started · [x] spec read · [x] building · [x] gates green · [x] ready for review

## What shipped

Branch: `ws3-results-ui`.

- `lib/audit/mockReport.ts` — local contract-v1 types (`PageMeta`,
  `AuditReport`, `AuditErrorKind`, `AuditStreamEvent`) per DATA-CONTRACT §2/§4,
  plus `mockReport`: a complete `AuditReport` (all 18 signals, 4 lenses, every
  `AuditFindings` array non-empty, 3 rewrite hunks). The 11 DET signals run
  through the real `@aeo/scoring` engine (`computeParsedDocument` +
  `DET_SIGNALS`) against a real fixture article
  (`packages/scoring/fixtures/05-mediocre-a.md` — "Understanding Backlinks in
  SEO"); lens scores + hard caps are derived via the engine's own
  `computeLensScore`/`applyHardCaps`, so nothing here is a hand-typed lens
  number. The 7 RUB signals are hand-authored (standing in for the LLM
  rubric), grounded in the same article's actual text.
- `app/hooks/useAuditStream.ts` — `useAuditStream(url)`: POSTs `/api/audit`,
  reads the SSE body via `fetch` + a stream reader, parses frames with
  `parseAuditFrame`, and folds them through the exported pure
  `auditStreamReducer` into `{ phase, page, signals, scores, findings,
  rewrites, error }`. No resume/polling — a dropped connection or non-2xx
  response is just an error state; `retry()` re-POSTs the same url.
- `app/components/audit/AuditReportView.tsx` — the presentational report
  (skeleton → partial → full → error-with-partial), driven entirely by props
  so it renders identically from the live hook or straight from `mockReport`.
- `app/components/audit/AuditRunner.tsx` — thin client container: calls
  `useAuditStream(url)`, hands the state to `AuditReportView`.
- `app/components/audit/ReportHeader.tsx` — title, final URL (external link,
  `rel="noopener noreferrer"`), word count, fetched-at; plus a skeleton
  variant for the pre-`meta` state.
- `app/components/audit/FindingsPanel.tsx` — blockers/question-gaps/weak
  signals via the existing (unmodified) `buildFindingItems` +
  `FindingsDrawer`/`SeverityChip`; anchor suggestions, quotables, and Q&A
  pairs get their own plain sections (they carry no severity in the
  contract).
- `app/components/audit/RewritesPanel.tsx` — read-only rewrite hunks.
- `app/dev/mock-report/page.tsx` — renders `AuditReportView` against
  `mockReport` directly, bypassing the hook; `notFound()` unless
  `NODE_ENV === "development"` (verified 404 in a real `next start` — see
  Evidence).
- Adapted (not forked) from the existing kit:
  - `app/components/ui/DiffHunk.tsx` — added `readOnly` (hides the
    accept/reject/undo footer; `onAccept`/`onReject`/`onReset` now optional).
  - `app/components/workbench/ScoreRail.tsx` — dropped workbench-only
    concepts (`isEstimated`, `hasAudit`, `modelId`, `error`/`errorKind`,
    `costEstimate`, `onRun`/`onCancel`, the `no_key` Settings link); added
    `hasSignals` so the "Structure" phase chip is actually gated on the
    `signals` event instead of being hardcoded `done`.
  - `SignalBreakdown.tsx`, `EeatStrip.tsx`, `FindingsDrawer.tsx`,
    `SeverityChip.tsx`, `derive.ts` (`buildFindingItems`) — reused
    **unmodified**; `AuditFindings`/`ScoreBreakdown` are unchanged by the v1
    contract, so nothing there needed adapting.
  - Left untouched and unused: `RewritePanel.tsx`, `WorkPanel.tsx`,
    `RoadmapPanel.tsx`, `SchemaBlock.tsx`, `EditorPane.tsx`, `ExportMenu.tsx`
    — not part of the v1 report layout (no editable doc, no roadmap/schema
    panel in scope) and `ExportMenu.tsx` still has a passing test
    (`test/components/exportMenu.test.ts`) I didn't want to disturb.
- Tests:
  - `test/client/useAuditStream.test.ts` — `auditStreamReducer` against
    synthetic frame sequences built via `formatAuditEvent` →
    `parseAuditFrame` (producer/consumer symmetry), covering the full
    meta→signals→scores→rewrites→done order, an error mid-stream keeping
    partial data, `retryAfter` propagation, and `reset`.
  - `test/components/auditReportView.test.ts` — DATA-CONTRACT field coverage
    against `mockReport` (every signal id, every lens, every findings array
    non-empty and ≤10 items, 2–3 rewrite hunks each with a `targetSignal`),
    plus the field→component mapping logic (`buildFindingItems`, `eeatFrom`,
    `primaryLensFor`, `formatFetchedAt`).
  - `test/e2e/mock-report.spec.ts` — Playwright + axe against
    `/dev/mock-report`: full render, keyboard nav through findings
    (Up/Down/Home/End), read-only rewrites (no Accept/Reject buttons), no
    horizontal overflow at 320/768/1024/1440 (with a screenshot at each), axe
    critical/serious violations = none.

## Decisions taken

- **WS3-D1 — contract-v1 types live in `mockReport.ts`, not `lib/audit/types.ts`.**
  `lib/audit/types.ts` on this branch still carries the pre-pivot BYOK shape
  (`done` with an `auditId`, no `meta` event, `no_key`/`invalid_key`/...
  error kinds) — WS2 hasn't landed the contract edit yet. Per the spec's
  constraints section, I defined `PageMeta`/`AuditReport` locally; since
  `AuditStreamEvent`/`AuditErrorKind` also changed shape in v1 (not just
  additive), I defined those locally too, each tagged
  `// contract-v1: moves to lib/audit/types.ts at merge`. `AuditFindings`,
  `AuditRewrites`, `RewriteHunk`, `AuditStreamPhase` are unchanged by the
  contract and still come from `lib/audit/types.ts` as-is.
- **WS3-D2 — bridging `parseAuditFrame`/`formatAuditEvent` via a cast.** Both
  are typed against the old `AuditStreamEvent` in `lib/audit/types.ts`, but
  they only serialize/parse JSON by `type` — no logic depends on the union's
  exact members. The hook and tests cast through `unknown` at the boundary,
  commented, rather than duplicating the (de)serializer.
- **WS3-D3 — severity chips only on blockers/gaps/weak-signals, not on every
  findings category.** The spec's report-layout section parenthesizes
  "severity-chipped" only next to blockers, and the contract's
  `AuditFindings` carries no severity field for anchor suggestions,
  quotables, or Q&A pairs. I reused the existing 3-tier Blocker/Gap/Weak
  Signal `SeverityChip` (already in the codebase, already accessible) for
  blockers + question gaps + weak signals, and gave anchor
  suggestions/quotables/Q&A pairs their own plain (unchipped) sections. I did
  **not** introduce a new Critical/High/Medium/Low taxonomy — the contract
  has no severity field to back one, and the existing component already
  covers the "chip a finding" need. Flagging this since an early instruction
  in this session mentioned "Critical/High/Medium/Low" chips; happy to add a
  4-tier system if that's actually wanted, but it'd be inventing severities
  the data doesn't carry.
- **WS3-D4 — component tests are pure-logic, not rendered.** This repo has no
  jsdom/happy-dom/`@testing-library/react` (vitest runs in the `node`
  environment — `vitest.config.ts`), and "no new dependencies" is an
  explicit constraint. Following the existing `exportMenu.test.ts` precedent
  (which tests bundle-building logic, never renders JSX), the "component"
  test pins DATA-CONTRACT field coverage on `mockReport` plus the exported
  field→component mapping helpers (`eeatFrom`, `primaryLensFor`,
  `formatFetchedAt`). Actual DOM rendering is covered by the Playwright e2e
  spec instead.
- **WS3-D5 — mock article deliberately triggers a real hard cap.** First pass
  used a "good" tier fixture (04-good-b.md) — realistic but scored mid-range
  with no lens capped, so the capped-lens UI (badge + reason banner) never
  rendered. Switched to `05-mediocre-a.md`, whose H1 section genuinely has no
  intro paragraph (S1 computes to a real `0`), which trips the AI Overview
  hard cap — I did not hand-tune this; it's what the real engine returns for
  that real content per `applyHardCaps`'s own threshold (`S1 < 30`). The
  raw weighted composite for `aiOverview` (~25) ends up already below the cap
  ceiling (40) with this signal mix, so `capped` stays `false` per
  `applyHardCaps`'s own rule ("only set when the cap actually suppresses the
  raw score") — I chose not to hand-inflate other RUB signals to force
  `capped: true`, since that would mean writing an internally-inconsistent
  rubric (e.g. a high "answer directness" score alongside "no answer
  exists"). The capped-badge code path itself is inherited, pre-existing UI
  logic (`ScoreTile`'s `capped` prop, `SignalBreakdown`'s cap-reason banner)
  and isn't new code from this workstream.

## Deviations from spec

- None beyond what's captured in Decisions above. Report layout, mock
  fixture shape, hook signature, and file ownership all match the spec as
  written.

## Requests across the boundary

- None yet. Once WS2 lands the `lib/audit/types.ts` contract edit (`meta`
  event, `AuditReport`, the v1 `AuditErrorKind` set), the local types in
  `mockReport.ts` should be deleted and re-pointed at `lib/audit/types.ts` —
  flagging so the coordinator can sequence that swap without both
  workstreams editing the same file at once.

## Open questions for the coordinator

- Confirm WS3-D3 (severity taxonomy) — see above. Everything else was
  unambiguous from the spec + DATA-CONTRACT.

## Evidence

```
$ pnpm lint && pnpm typecheck && pnpm test && pnpm build
✓ eslint — clean
✓ tsc --noEmit — clean
✓ vitest run — 16 files, 161 tests passed
✓ next build — Compiled successfully, /dev/mock-report in the static route list
```

```
$ pnpm e2e   (playwright test, next dev + AUDIT_TEST_MOCK=1)
✓ renders the complete report from mock data alone
✓ keyboard navigation moves through the findings list
✓ is gated out of production (NODE_ENV !== development)
✓ no horizontal overflow at 320px / 768px / 1024px / 1440px
✓ axe: no critical or serious violations
8 passed (5.8s)
```

Production-mode gate check (real `next start`, not just build status — see
`docs/ARCHITECTURE.md` D-007):
```
GET /dev/mock-report -> 404
GET /                -> 200
```

Screenshots (regenerated by `pnpm e2e`, not committed —
`/test-results` is gitignored): `test-results/mock-report-{320,768,1024,1440}.png`.
Visually confirmed: 320/768 stack the findings/rewrites panels to one column
and keep the 2×2 score-tile grid intact with no overflow; 1024/1440 place
findings and rewrites side by side.

Field → component checklist (DATA-CONTRACT §4/§5, all present in
`mockReport` and rendered):

| Field | Component |
|---|---|
| `page.{url,finalUrl,title,wordCount,fetchedAt}` | `ReportHeader` |
| `scores.lenses` (4) | `ScoreRail` (`ScoreTile` × 4) |
| `scores.signals` (18) | `SignalBreakdown` (per-lens, on tile click) |
| `scores.signals.S17` | `EeatStrip` |
| `scores.{rubricVersion,signalsVersion,modelId}` | `ScoreRail` footer caption |
| `findings.blockers` | `FindingsPanel` → `FindingsDrawer` (Blocker chip) |
| `findings.questionGaps` | `FindingsPanel` → `FindingsDrawer` (Gap chip) |
| weak signals (derived from `scores`) | `FindingsPanel` → `FindingsDrawer` (Weak signal chip) |
| `findings.anchorSuggestions` | `FindingsPanel` "Anchor suggestions" section |
| `findings.quotables` | `FindingsPanel` "Quotables" section |
| `findings.qaPairs` | `FindingsPanel` "Q&A pairs" section |
| `rewrites.hunks` (`kind`,`label`,`before`,`after`,`targetSignal`) | `RewritesPanel` → `DiffHunk` (read-only) |
| `phase`/`error` | `AuditReportView` top-level error banner + skeleton states |

## Coordinator review

(appended by coordinator: verdict merge / changes-requested + notes)
