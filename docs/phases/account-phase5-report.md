# Phase 5 account recovery report

Date: 2026-07-20

## Delivered

- Optional Supabase email-link authentication without blocking anonymous
  audits.
- Verified bearer-session ownership for history, reports, settings, and
  DataForSEO tasks.
- Atomic device-to-account workspace claiming for audit summaries, full
  reports, preferences, provider tasks, and usage-ledger entries.
- Account data remains behind server-only RLS; the browser publishable key has
  no direct table privileges and the claim RPC is service-role-only.
- Account-aware cloud requests, dashboard/settings refresh after ownership
  changes, sign-out fallback to device ownership, and an accessible account
  drawer with focus restoration.
- Responsive mobile header after adding the account action.

## Production configuration

- Migration `202607200003_account_workspace_linking.sql` applied to the
  production Supabase project.
- Supabase Auth Site URL set to
  `https://seo-ai-audit-pied.vercel.app`.
- `https://seo-ai-audit-pied.vercel.app/dashboard` added to the redirect
  allowlist.

## Verification

- The transactional production SQL test copied all five record groups,
  confirmed anonymous/authenticated roles cannot invoke the RPC, deleted the
  source workspace, and rolled every synthetic row back. The editor returned
  `account workspace linking verified`.
- Lint, TypeScript, production build, 270 unit/integration tests, and 22
  Playwright journeys pass.
- Browser coverage verifies the optional sign-in drawer, keyboard focus, and
  320-pixel header layout. API tests verify account-session enforcement and
  owner resolution.
- Commit `7b51ac2` was deployed as
  `dpl_91Qtr94emxTMS7FnCZPBHygCZwTL` and attached to the canonical alias.
  Production HTML and the rendered browser both expose the optional account
  drawer. Anonymous history returns HTTP 200, while `/api/account/link`
  without a verified session returns HTTP 401 `invalid_session`.

## Live account proof

A reversible production test user established a real Supabase session. An
anonymous audit was saved under device A, claimed by the account, recovered
with the same session and a different device B token, and deleted. The test
user was then removed and a database query confirmed zero synthetic audit
rows.

Magic-link initiation reaches Supabase correctly. The project currently uses
the built-in limit of two emails per hour; Supabase disables the email-limit
control until custom SMTP is configured. Production-grade email delivery is
therefore an operator configuration prerequisite, not an application-code gap.
