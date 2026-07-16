# WS3 — Results Dashboard UI (spec)

Branch: `ws3-results-ui`. Read first: `docs/ARCHITECTURE.md`,
`docs/DATA-CONTRACT.md` (you are its consumer), `docs/COORDINATION.md`.
Your report: `docs/phases/ws3-report.md`.

## Goal

The visual audit report: components that consume DATA-CONTRACT v1.0 — built
and demo-able against **mock data first**, so you never wait on WS2. Plus the
client SSE hook that will feed them live once WS2 merges.

## Context you need

- A results-UI kit already exists (pre-pivot workbench, auth-free, kept):
  `app/components/ui/` — `ScoreTile` (animated 0–100 tile), `SeverityChip`,
  `Card`, `Button`, `DiffHunk`; `app/components/workbench/` — `ScoreRail`
  (4-lens rail), `SignalBreakdown`, `EeatStrip`, `FindingsDrawer`,
  `RoadmapPanel`, `SchemaBlock`, `RewritePanel`… Some props reference
  workbench concepts (re-score, cost estimates, document editing) that are
  dead in v1 — adapt or slim as needed; they're yours now.
- How they composed before: `git show "backup/pre-rewrite:app/app/doc/[id]/Workbench.tsx"`.
- Design system: tokens in `app/globals.css`; score colors are ALWAYS paired
  with a text/glyph cue (see `lib/audit/scoreScale.ts`); reduced-motion is
  already handled globally via `[data-animate]`.
- Signal metadata (names, descriptions, lens weights for display):
  `lib/audit/signalMeta.ts`.

## Tasks

1. **Mock first**: create `lib/audit/mockReport.ts` — a complete
   `AuditReport` per DATA-CONTRACT §5 (all 18 signals, 4 lenses, non-empty
   findings, 2–3 rewrite hunks; mine `lib/audit/e2eFixture.ts` and
   `packages/scoring/fixtures/` for realistic content).
2. **`useAuditStream(url)` hook** (`app/hooks/useAuditStream.ts`): POSTs to
   `/api/audit`, reads the SSE body via `fetch` + reader, parses frames with
   `parseAuditFrame` (`lib/audit/stream.ts`), accumulates
   `{ phase, page, signals, scores, findings, rewrites, error }`.
   No resume/recovery logic — a dropped stream is just an error state with a
   "Run again" affordance. (The pre-pivot hook,
   `git show backup/pre-rewrite:app/hooks/useAuditStream.ts`, shows the
   frame-reading loop; delete its documentId/provider/resume concepts.)
3. **`AuditRunner` component** (`app/components/audit/AuditRunner.tsx`):
   client component, props `{ url: string }` — calls the hook, renders the
   full progressive experience:
   - streaming: skeleton tiles (`wb-skeleton`), then DET signals as they
     land, then scores/findings, then rewrites;
   - done: the full report (below);
   - error: kind-specific message (contract error kinds) + retry button;
     keep partial data visible under it (contract §6.5).
4. **Report layout** (compose existing kit, adapt where props are stale):
   - Header: page title, final URL (external link, `rel="noopener"`),
     word count, fetched-at.
   - Score rail: 4 lens tiles with cap badges + reasons.
   - Signal breakdown: DET details ("why this score") + RUB evidence quotes.
   - Findings: question gaps, anchor suggestions, blockers (severity-chipped),
     quotables, Q&A pairs.
   - Rewrites: read-only before/after hunks (`DiffHunk`), labeled with target
     signal. No accept/reject editing in v1.
5. **Demo route for development**: `app/dev/mock-report/page.tsx` rendering
   `AuditRunner`'s presentational layer with `mockReport` (bypassing the
   hook) — this is your development target and the review surface before WS2
   lands. Gate it out of production (`notFound()` unless
   `process.env.NODE_ENV === "development"`).
6. **Tests**:
   - Unit: hook reducer/accumulation logic against synthetic frame sequences
     (use `formatAuditEvent` to build fixtures — producer/consumer symmetry).
   - Component: report renders every contract field from `mockReport`
     (vitest; follow the existing `test/components/exportMenu.test.ts`
     pattern).
   - E2E + axe on `/dev/mock-report`: renders, no critical/serious
     violations, keyboard navigation through findings.
7. **Responsive pass**: 320 / 768 / 1024 / 1440 — no horizontal overflow;
   the rail stacks on mobile. Screenshot each breakpoint of the mock report
   into your report.

## Constraints

- Build against `mockReport` ONLY until WS2 merges; the hook's network path
  is exercised by integration later (WS1 wires it).
- No new dependencies (no chart libs — the existing bar/tile primitives are
  the system).
- Files you own: `app/components/**`, `app/hooks/**`, `app/dev/**`,
  `lib/audit/mockReport.ts`, `test/components/**`, `test/client/**`,
  `test/e2e/mock-report.spec.ts`. Don't touch `app/api/**`, `lib/import/**`,
  `app/page.tsx`, `app/audit/**`.
- Type imports come from `lib/audit/types.ts` / `@aeo/scoring` as they exist
  on YOUR branch; if WS2's contract edit hasn't merged yet, define the two
  new types (`PageMeta`, `AuditReport`) locally in `mockReport.ts` with a
  `// contract-v1: moves to lib/audit/types.ts at merge` comment.

## Acceptance criteria

- [ ] `/dev/mock-report` renders the complete report from mock data alone.
- [ ] Every DATA-CONTRACT field appears somewhere in the UI (checklist in
      report mapping field → component).
- [ ] Progressive states (skeleton → partial → full → error-with-partial)
      demonstrable and tested.
- [ ] Axe: no critical/serious violations; score colors have text/glyph cues.
- [ ] Responsive at 320/768/1024/1440 (screenshots in report).
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.
