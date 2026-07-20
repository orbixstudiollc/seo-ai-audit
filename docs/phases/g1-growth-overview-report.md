# G1 — Growth overview (phase report)

Branch: `wsp-growth-1`. Plan: `~/.claude/plans/shimmying-launching-elephant.md`
(approved). Built step-by-step by the coordinator session.

## What shipped

- `/dashboard` is now two URL-state tabs: **Growth** (default) and
  **History** (existing `DashboardClient` mounted unchanged — it keeps sole
  ownership of mutations and the cloud migration, so the tabs never race).
- `lib/growth/aggregate.ts` — pure per-domain aggregation (group, chronological
  score series, delta vs previous, needs-attention ranking, workspace
  summary); 8 unit tests.
- `app/components/growth/` — `GrowthOverview` (client, same local+cloud merge
  the history tab uses), `SiteGrowthCard` (latest lens scores with band dots,
  delta chip, sparkline, latest-report/re-run/history links),
  `TrendSparkline` (pure SVG polyline, no chart lib).
- Needs-attention strip: domains whose latest audit dropped (worst first) or
  failed, each with a one-click re-audit.
- Dormant seam wired: `TechnicalSeoPanel` now emits its crawl pages
  (`onPages`) → `SavedReportClient` → `SiteAuditReportView` →
  `actionPlanForSite(..., technicalPages)` — DataForSEO issue keys finally
  reach the action plan (the synthesizer supported it; no caller fed it).
- A11y: axe-clean growth tab. Small colored score text renders as
  ink + band-colored glyph/dot (color never the only cue AND contrast-safe);
  the large score keeps band-colored text (large-text AA).
- e2e: 5 new growth specs (default tab, deltas, attention strip, tab switch,
  empty state, axe, 320px) + 4 existing specs updated for the new default tab
  (history assertions now navigate to `?tab=history` — same intent).

## Evidence

lint ✓ · typecheck ✓ · unit **306/306** (was 288) · build ✓ · e2e **30/30**.

## Coordinator review

Guardrails held: only existing tokens/primitives, URL-as-state tabs,
DashboardClient untouched, pure aggregation fully tested. Verdict: **merge**.
