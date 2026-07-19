# Dashboard, local history, and settings — phase report

## Status

- [x] implemented on `phase4-dashboard-history-settings`
- [x] anonymous / no database constraint preserved
- [x] quality gates green
- [x] ready for coordinator review

## What shipped

- Persistent global header with New audit, Dashboard, and Settings on every route.
- `/dashboard` with browser-local audit history, search, mode filter, score/date sorting, rerun/open/remove actions, empty/no-results states, and responsive cards.
- Versioned history module in `lib/history/`: validation, corrupt-data recovery, same-tab change events, duplicate protection, and configurable 10/25/50 record caps.
- Single-page and whole-site completion integration. Whole-site audits save one rollup record, never one record per crawled page. Meaningfully partial scored results are retained.
- Versioned settings module and accessible settings drawer: default audit mode, history limit, autosave, clear confirmation, reduced motion, reset, and clear history.
- Post-audit confirmation with Dashboard and Run another audit actions.
- Accurate privacy copy: summaries stay in the current browser and disappear when browser data is cleared.

## Storage schemas

History key: `seo-ai-audit:history:v1`. Records contain a local ID, URL/final URL, title, mode, timestamp, complete/partial status, four compact lens scores, and optional site page count. Full reports, provider responses, page content, API keys, and headers are deliberately not stored, keeping records compact and avoiding localStorage quota pressure.

Settings key: `seo-ai-audit:settings:v1`. Invalid, corrupt, or future-version data falls back to safe defaults. Defaults: single-page mode, 25 records, autosave on, clear confirmation on, system motion preference.

## Decisions

1. Compact summaries rather than full reports. “Run again” is explicit and refreshes the audit; this avoids silently exhausting browser storage.
2. localStorage only, per D-001. There is no server persistence or account sync.
3. Saving is best-effort and isolated from the stream UI; unavailable storage can never break an audit result.
4. Settings never expose or accept server provider credentials.

## Verification

```text
pnpm lint       PASS
pnpm typecheck  PASS
pnpm test       PASS — 27 files, 230 tests
pnpm build      PASS — /dashboard statically generated
pnpm e2e        PASS — 16 Chromium journeys
```

E2E covers persistent dashboard records, removal/empty state, global Settings, default-mode persistence, single-audit autosave, whole-site single-record autosave, keyboard focus return, existing responsive report checks, and axe checks.

## Remaining risks / follow-up

- History is device/browser specific by design; account sync remains Phase 5.
- Saved summaries do not reopen frozen full reports; users rerun an audit for fresh detail.
- A dedicated dashboard-only responsive/axe suite can be added during coordinator review if desired; the shared header/settings and existing global route suite are green.
- Production’s configured Anthropic-compatible proxy accepts ordinary messages but does not honor the AI SDK structured-output request; provider compatibility remains a separate release blocker unrelated to this phase.

