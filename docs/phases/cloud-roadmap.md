# Cloud and provider roadmap

Date: 2026-07-20

This roadmap captures the remaining phases authorized by the instruction to
complete all phases. It extends, rather than renumbers, the anonymous audit
workstreams already shipped.

## Cloud Phase 1 — Supabase durability (complete)

- Private anonymous workspace ownership.
- Durable audit summaries, reopenable reports, and settings.
- Browser-cache migration and offline fallback.
- Provider task and usage-ledger foundations.

Evidence: `docs/phases/supabase-phase1-report.md`.

## Cloud Phase 2 — DataForSEO technical crawl (implemented; activation pending credentials)

- Server-only Basic authentication using `DATAFORSEO_LOGIN` and
  `DATAFORSEO_PASSWORD`.
- An explicit, cost-visible technical crawl for a saved whole-site audit.
- A hard maximum of 500 pages and conservative options: no JavaScript,
  browser rendering, or resource loading surcharges.
- Durable, owner-scoped task state and provider-cost ledger entries.
- Cross-instance idempotency so repeated clicks cannot create duplicate paid
  tasks.
- Polling and normalized technical results: crawl progress, HTTP status,
  click depth, DataForSEO on-page score, and issue flags for every returned
  page.
- A paginated technical section inside the reopenable whole-site report.
- Provider mock/integration tests, migration, production credentials, deploy,
  and a real low-limit validation task.

DataForSEO credentials are server-only. The API password is generated in the
DataForSEO API Access screen and is not the account password.

## Phase 5 — account identity and cross-device recovery (in progress)

- Supabase Auth with an email-link flow; anonymous auditing remains available.
- Link the current anonymous workspace to the signed-in user without losing
  existing history, reports, provider tasks, settings, or usage records.
- Verified bearer sessions and server-side ownership checks; audit tables stay
  inaccessible to browser roles under server-only RLS.
- Cross-device dashboard/report/settings access after sign-in.
- Sign-out returns the browser to a fresh anonymous workspace without exposing
  another account's records.
- Auth, ownership-transfer, and browser-flow tests; migration and production
  validation.

## Completion boundary

“All phases complete” means Cloud Phase 2 and Phase 5 are implemented,
migrated, deployed, and validated against production. Provider-backed live
validation requires the corresponding production credentials; code-only or
mock-only verification is not sufficient for final completion.
