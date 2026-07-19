# Dashboard, local history, and settings — phase report

## Status

- [x] implemented on `phase4-dashboard-history-settings`
- [x] anonymous / no database constraint preserved
- [x] quality gates green
- [x] ready for coordinator review

## What shipped

- Persistent global header with New audit, Dashboard, and Settings on every route.
- `/dashboard` with browser-local audit history, search, mode filter, score/date sorting, rerun/open/remove actions, empty/no-results states, and responsive cards.
- Dedicated read-only `/report/[id]` views for reopening saved single-page and whole-site reports later.
- Versioned history module in `lib/history/`: validation, corrupt-data recovery, same-tab change events, duplicate protection, and configurable limits up to 500 audit records.
- Client-side dashboard pagination renders 10 audit cards at a time, with filtered-result counts and previous/next controls.
- Single-page and whole-site completion integration. Whole-site audits save one rollup record, never one record per crawled page. Meaningfully partial scored results are retained.
- Versioned settings module and accessible settings drawer: default audit mode, history limit, autosave, clear confirmation, reduced motion, reset, and clear history.
- Post-audit confirmation with Dashboard and Run another audit actions.
- Accurate privacy copy: history and reopenable reports stay in the current browser and disappear when browser data is cleared.

## Storage schemas

History key: `seo-ai-audit:history:v4` (with automatic migration from v1/v2/v3).
Every submitted query is recorded immediately and updated in place through
started, failed, partial, or complete status. Records contain a local ID,
URL/final URL, title, mode, timestamp, optional compact lens scores, and
optional site page count and an availability flag for the separately stored
report. Provider responses, fetched source HTML, API keys, and headers are not
stored.

V3 adds a bounded detail snapshot so users can reopen useful context from each
dashboard card: up to five weakest signals, blockers, question gaps, citation
claims, rewrite count, word count, or site worst-pages/common-findings data.
Older migrated records remain usable and explain that a rerun is needed to
populate the new snapshot.

Completed or meaningfully partial reports are stored separately in versioned
browser IndexedDB (`seo-ai-audit:reports`). Report entries are keyed by the
history ID, pruned to the configured history limit, and deleted with their
dashboard record. Older migrated summaries remain rerunnable but do not claim
to have a reopenable report.

Settings key: `seo-ai-audit:settings:v1`. Invalid, corrupt, or future-version data falls back to safe defaults. Defaults: single-page mode, 25 records, autosave on, clear confirmation on, system motion preference.

## Decisions

1. Compact summaries remain in localStorage; full reopenable reports use IndexedDB to avoid localStorage quota pressure.
2. Browser storage only, per D-001. There is no server persistence or account sync.
3. Saving is best-effort and isolated from the stream UI; unavailable storage can never break an audit result.
4. Settings never expose or accept server provider credentials.

## Verification

```text
pnpm lint       PASS
pnpm typecheck  PASS
pnpm test       PASS — 29 files, 240 tests
pnpm build      PASS — /dashboard static; /report/[id] dynamic
pnpm e2e        PASS — 20 Chromium journeys
```

E2E covers persistent and paginated dashboard records, removal/empty state, global Settings, default-mode persistence, single-audit autosave and reopen, whole-site single-record autosave and reopen, keyboard focus return, existing responsive report checks, and axe checks.

## Remaining risks / follow-up

- History is device/browser specific by design; account sync remains Phase 5.
- Reports are device/browser specific and best-effort; if IndexedDB is unavailable, the compact dashboard record remains rerunnable.
- A dedicated dashboard-only responsive/axe suite can be added during coordinator review if desired; the shared header/settings and existing global route suite are green.
- Production’s configured Anthropic-compatible proxy accepts ordinary messages but does not honor the AI SDK structured-output request; provider compatibility remains a separate release blocker unrelated to this phase.
