# Supabase Phase 1 report

Date: 2026-07-20

## Delivered

- Server-only Supabase client using `SUPABASE_SECRET_KEY` with legacy
  `SUPABASE_SERVICE_ROLE_KEY` fallback.
- SQL migration for `audit_runs`, `audit_reports`, `device_settings`, and the
  Phase-2-ready `provider_tasks` and `usage_ledger` tables.
- RLS enabled with all anonymous/authenticated table privileges revoked.
- Random 256-bit browser workspace token; only its SHA-256 hash is stored in
  Supabase.
- `/api/history` list/upsert/report/delete/clear operations with payload and
  ownership validation.
- `/api/settings` cloud preference reads and writes.
- Existing localStorage summaries and IndexedDB reports migrate into cloud
  storage once, while remaining available as an offline fallback.
- Cloud/local merge protects completed records from stale in-progress copies.
- Saved-report loading falls back from IndexedDB to Supabase and restores the
  local cache.
- Dashboard keeps 10-item pagination across a maximum of 500 records and now
  communicates synchronization state.

## Verification

- Lint: passed.
- TypeScript: passed.
- Unit/integration: 251 passed.
- Production build: passed.
- Playwright: 21 passed.
- Live Supabase schema probe: `audit_runs` currently returns `PGRST205`; the
  migration has not yet been applied. Existing `public.audits` returned an
  empty array and was not modified.

## Activation requirement

Run `supabase/migrations/202607200001_phase1_audit_storage.sql` in the project
SQL editor, then deploy. Until the table exists, the API returns 503 and the UI
stays safely in browser-fallback mode.
