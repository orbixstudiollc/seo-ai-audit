# HANDOFF log

Append-only, newest entry LAST. **Closing ritual (every session):** before
wrapping up, (1) update `PROJECT-STATUS.md` to reflect reality, (2) append an
entry here in the format below. The coordinator flags any session that wraps
without both.

Entry format — a ready-to-paste prompt for the next session:

```
## <date> · <session/workstream name> · <branch@commit>
DONE: what shipped, one dense paragraph or bullets.
NEXT: the most valuable next actions, in order.
CONTEXT: everything the next session must read/know to start cold
(files, docs, gotchas, pending user actions).
```

---

## 2026-07-17 · WS1 Scaffold (retroactive) · ws1-scaffold@3fdc239

DONE: Anonymous landing page (`app/page.tsx` + `AuditUrlForm` client island),
`/audit` results shell with server-side URL re-validation, shared site
header + full OG/Twitter metadata, `public/llms.txt`, 4 Playwright e2e specs
incl. axe. Deployed to production and verified per D-007 (200 + real HTML on
`/`, `/robots.txt`, `/llms.txt`). Root-caused the pre-pivot "site
unreachable": old auth-gated deployment was 307-ing to /login with dead DB.
Report + evidence: `docs/phases/ws1-report.md`.

NEXT: (was) wire WS3's AuditRunner into the `/audit` stub once WS2/WS3 land —
done by integrate-v1. Residual: remove stale Vercel env vars
(`DATABASE_URL`/`BETTER_AUTH_*`/`ENCRYPTION_KEY`) — still open.

CONTEXT: spec `docs/phases/ws1-scaffold-spec.md`; prod =
https://seo-ai-audit-pied.vercel.app (project `orbix2/seo-ai-audit`,
framework preset must stay `nextjs`, D-007).

## 2026-07-17 · WS2 Audit API (retroactive) · ws2-audit-api@48feb82

DONE: `POST /api/audit` (Node, maxDuration 300): per-IP rate limit → zod URL
validation → SSRF-guarded fetch (abortable) → Readability extraction →
~8k-word content cap → DET signals → server-key rubric + rewrites → SSE
exactly per DATA-CONTRACT v1 (`meta→signals→scores→rewrites→done`). Applied
the contract edit to `lib/audit/types.ts`; replaced BYOK provider factory
with `buildServerModel` (`ANTHROPIC_API_KEY`, `AUDIT_TEST_MOCK=1` mock);
new error mappers; `.env.example`. Integration tests with a real local HTTP
fixture. Flagged 5 cross-boundary files broken by the contract edit
(export/workbench leftovers) — resolved by integrate-v1's dead-file removal.
Report: `docs/phases/ws2-report.md`.

NEXT: (was) coordinator to resolve the export/ExportMenu breakage — done
(deleted in `202ded6`). Residual: abort seam inside frozen
`@aeo/scoring.runAudit` (a disconnect mid-rubric lets one LLM call finish);
revisit only if spend becomes a problem.

CONTEXT: spec `docs/phases/ws2-audit-api-spec.md`; contract
`docs/DATA-CONTRACT.md`; SSRF guard + fetch caps in `lib/import/`;
production rubric calls need the AI key in Vercel (pending user).

## 2026-07-17 · WS3 Results UI (retroactive) · ws3-results-ui@b7736dd

DONE: Results dashboard against DATA-CONTRACT v1 mock-first:
`lib/audit/mockReport.ts` (complete AuditReport), rewritten anonymous
`useAuditStream(url)` hook (POST + SSE reader, no resume), `AuditRunner`
progressive UI (skeleton → signals → scores/findings → rewrites → done /
error-with-partial), report layout composing the existing kit (ScoreTile,
ScoreRail + phase chips, SignalBreakdown, findings, read-only DiffHunk
rewrites), dev-only `/dev/mock-report` demo route, unit/component/e2e+axe
tests, responsive pass. Report: `docs/phases/ws3-report.md`.

NEXT: (was) wire into `/audit` — done by integrate-v1.

CONTEXT: spec `docs/phases/ws3-results-ui-spec.md`; the mock is the contract
fixture — keep it in sync with any contract change.

## 2026-07-17 · Integration (retroactive) · integrate-v1 → main@ac1b7fe

DONE: Merged `ws2-audit-api` + `ws3-results-ui` into `ws1-scaffold`'s line
(zero conflicts — ownership boundaries held), removed dead pre-pivot
export/workbench files (`202ded6`, resolving WS2's cross-boundary flags),
wired `/audit` to the real SSE pipeline (`801df56`), added a real end-to-end
audit e2e spec (`a45832f`), deployed to production. Coordinator review pass 1
appended to all three ws-reports. `main` fast-forwarded to `ac1b7fe`.

NEXT: (1) user sets the AI key in Vercel → verify a real LLM-scored audit in
prod; (2) review + merge `provider-flex` (flexible AI_PROVIDER/AI_BASE_URL/
AI_API_KEY/AI_MODEL, OpenAI-compatible endpoints); (3) review + merge
`ws4-crawl-bulk` (bulk audit, site crawl, SSRF pinned-IP fix) when pushed;
(4) then spec Phase 4 (export/share/schema/history) from
`docs/phases/later-phases.md`.

CONTEXT: prod https://seo-ai-audit-pied.vercel.app; canonical status
`PROJECT-STATUS.md`; wipe SQL `scripts/db-wipe.sql` awaiting user; Phase 5
auth stays deferred (D-001). Git push from this machine:
`env -u GH_TOKEN git push …` (env token is scope-limited).

## 2026-07-17 · Provider-flex · provider-flex@3939732

DONE: Replaced the `ANTHROPIC_API_KEY`-only model factory
(`lib/audit/provider.ts`) with an env-driven `resolveProvider()`:
`AI_PROVIDER=openai-compatible` + `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL`
covers OpenRouter/zenmuz.ai/Ollama/vLLM/LiteLLM via one code path
(`.chat(modelId)` — classic chat/completions, not the newer responses API);
`AI_PROVIDER=anthropic` covers Anthropic direct or an Anthropic-compatible
proxy. No `AI_PROVIDER` set (or an unrecognized value) → byte-for-byte the
old `ANTHROPIC_API_KEY`-only behavior — **no breaking change**, verified
live against production. Salvaged both proxy-quirk workarounds from
`backup/pre-rewrite:lib/audit/provider.ts` (the `.chat()` fix, the
Anthropic-proxy `/v1` insertion fix) rather than rediscovering them.
`mapLlmError` needed no changes — its never-log-keys discipline was already
provider-agnostic. 16 new/rewritten tests in `provider.test.ts` (9
`resolveProvider` precedence/fallback cases + a mocked HTTP round trip
proving the openai-compatible path hits the right URL/key/model). Also
applied two trivial fixes from `docs/reviews/ws1-gaps.md` (out of
`ws1-scaffold-gap-review`): a visible focus state on the landing page's URL
input (was `focus:outline-none` with no replacement), and baseline security
headers in `next.config.ts` (CSP/HSTS/nosniff/frame-ancestors/
referrer-policy/permissions-policy — `'unsafe-eval'` on `script-src` is
dev-only, confirmed absent in the live prod CSP header). Deployed to
production; live-verified degradation is unchanged (real fetch + DET
signals stream, generic key-safe error on the LLM phase) and the new
headers don't break hydration/CSP. `docs/DATA-CONTRACT.md` untouched —
provider choice is a server-side implementation detail. Full report:
`docs/phases/provider-flex-report.md`.

NEXT: (1) coordinator review + merge `provider-flex` to `main`; (2) once
merged, decide whether to actually configure a non-Anthropic provider in
Vercel (OpenRouter/etc.) or stick with `ANTHROPIC_API_KEY` — the
openai-compatible path is implemented and unit-tested but not yet exercised
end-to-end against a real third-party endpoint in production (only the
mocked round trip); (3) the still-open user actions from the integration
handoff (AI key in Vercel, Supabase wipe, stale env var cleanup) are all
still pending, unchanged by this session; (4) `docs/reviews/ws2-gaps.md`'s
SSRF DNS-rebinding TOCTOU (#1) and hardcoded-`[]` `quotables` (#5) are still
open — explicitly out of this session's scope (SSRF is `ws4-crawl-bulk`'s).

CONTEXT: spec came directly from the user (no `docs/phases/*-spec.md` for
this one — see `docs/phases/provider-flex-report.md` for the full brief);
branch `provider-flex` off `main@ac1b7fe`, not yet merged; `.env.example`
and `docs/ARCHITECTURE.md`'s "AI provider configuration" section document
the four new env vars. Gotcha for whoever reviews the SHA history: this
session also force-published a stray coordinator commit
(`0a878af`, this protocol doc itself) that existed only in a sibling
worktree's independent local clone (not shared object storage — worktrees
under this Conductor project turned out to be a mix of true linked
worktrees and fully independent clones; `git cat-file`/`git worktree list`
disagreeing on whether a SHA resolves is the tell). Verify SHAs before
assuming any worktree's objects are visible from another.

## 2026-07-19 · Release integration · release/provider-ws4@51ae0b8

DONE: Started from `origin/main@2cef058`, merged `provider-flex@3939732` and
`ws4-bulk-audit-crawl@2cc82fe`, and resolved their only content conflict by
retaining both the whole-site mode selector and the accessible URL-input focus
treatment. Added explicit quality-tool exclusions for Conductor's nested
`.claude`/`.conductor` worktrees. Verified lint, typecheck, 222/222
unit/integration tests, production build, and 14/14 Playwright journeys. The
release branch was pushed as a recoverable checkpoint.

NEXT: Promote the release line to `main`, allow the Git-linked Vercel project
to deploy, verify `/`, `/audit/site`, `/robots.txt`, `/llms.txt`, security
headers, and the bulk endpoint's expected validation response. Then configure
a real provider key in Vercel and verify a full LLM-scored production audit.

CONTEXT: Production is https://seo-ai-audit-pied.vercel.app. Provider config
is documented in `.env.example` and `docs/ARCHITECTURE.md`; whole-site design
and evidence are in `docs/phases/ws4-report.md`. The only blocking product
configuration is the real provider key. Supabase wipe and stale Vercel env
cleanup remain user actions; auth/persistence stays deferred by D-001.

## 2026-07-19 · Production verification · main@20f2b0c

DONE: Promoted the tested release to `main`, directly deployed
`orbix2/seo-ai-audit` to Vercel production as deployment
`dpl_4E53JVfhCX4xo4iEf1SRV95K7JSR`, and confirmed the canonical alias
`https://seo-ai-audit-pied.vercel.app`. Live probes verified the landing page
contains the Whole site mode, `/audit/site` renders for a valid URL,
`POST /api/audit/bulk` returns the expected 400 `invalid_url` contract for bad
input, robots.txt and llms.txt are served, and CSP/HSTS/nosniff/frame/referrer
security headers are active.

NEXT: Configure a real AI provider key in Vercel and run one complete
LLM-scored production audit. After that release sign-off, choose whether Phase
4 (export/share/schema/local history) is the next product milestone. The
Supabase wipe and stale environment-variable cleanup remain optional user
actions.

CONTEXT: Source and production are aligned at the 2026-07-19 release. The
release branch `release/provider-ws4` remains on origin as a recoverable
checkpoint. Provider configuration options are in `.env.example`; do not add
auth or persistence without revisiting D-001.

## 2026-07-19 · Dashboard/history/settings · phase4-dashboard-history-settings

DONE: Added a persistent global header and accessible Settings drawer, a
responsive `/dashboard`, versioned corruption-safe browser-local history and
settings modules, compact summary autosave for single-page and whole-site
audits, and post-audit Dashboard/Run another actions. Whole-site audits create
one rollup history item. No database, auth, report content, credentials, or
provider responses are stored. Gates: lint/typecheck/build PASS, 230/230 tests,
16/16 Playwright journeys. Full report:
`docs/phases/dashboard-history-settings-report.md`.

NEXT: Coordinator review this branch, with particular attention to storage UX
and the compact-summary/rerun decision; then merge and deploy if accepted.
Separately resolve the production proxy’s lack of structured-output support and
rotate the credential shared during configuration. Phase 4b export/share/schema
features remain parked.

CONTEXT: History key `seo-ai-audit:history:v1`, settings key
`seo-ai-audit:settings:v1`; both are validated and versioned. Dashboard records
cap at the user’s 10/25/50 preference and contain URLs, titles, status, lens
scores, timestamps, and optional site page count only. D-001 still forbids
server persistence/auth.

## 2026-07-19 · App completion / Phase 4b · phase4-dashboard-history-settings

DONE: Completed the remaining anonymous-v1 report features: local Markdown,
standalone HTML, scores JSON, site-summary Markdown/JSON exports; copyable FAQ
JSON-LD; stateless single/site share links; URL-specific social metadata and a
generated Open Graph image. Added a schema-validated plain-JSON retry for
providers that reject native structured output, narrowly classified so auth,
rate-limit, and server failures never retry. Gates: lint/typecheck/build PASS,
236/236 tests, 17/17 Playwright journeys. Report:
`docs/phases/report-export-provider-fallback-report.md`.

NEXT: Review PR #1, deploy it, and run a real provider-backed production audit
to prove the configured proxy returns schema-valid plain JSON through both LLM
calls. Rotate the previously shared provider credential. Phase 5 auth/database
work remains explicitly deferred by D-001.

CONTEXT: Exports are browser-generated and persist nothing. Share links rerun
the audited URL per D-006. The provider fallback validates against the original
Zod schemas and only retries structured-output capability failures. Production
verification is the only remaining anonymous-v1 release gate.

## 2026-07-19 · Anonymous v1 production release · main@0a966c1

DONE: Merged PR #1 into `main` at `0a966c1`, directly deployed production as
`dpl_9PsFRbmgcv3hvTCHei28ZnmVnZKD`, and confirmed the canonical alias. Live UI
verification proved `/dashboard`, global settings/navigation, and the 1200×630
Open Graph image. A real 5,215-word Wikipedia audit completed through the
configured proxy with AEO 45 / GEO 65 / Citability 70 / AI Overview 55,
rendered grounded findings and export/share controls, and saved a terminal
`complete` browser-local history record. This proves the validated plain-JSON
fallback works through both rubric and rewrite provider calls.

NEXT: Rotate the provider credential previously shared during setup. Optional
maintenance remains: run `scripts/db-wipe.sql` and remove stale pre-pivot
Vercel environment variables. Phase 5 auth/database work remains deferred by
D-001 and is not part of anonymous v1 completion.

CONTEXT: Production is https://seo-ai-audit-pied.vercel.app. Local release
gates remain lint/typecheck/build, 236 tests, and 17 Playwright journeys. The
deployed source is the content merged by PR #1; deployment inspector:
https://vercel.com/orbix2/seo-ai-audit/9PsFRbmgcv3hvTCHei28ZnmVnZKD.

## 2026-07-19 · All-query dashboard history · main

DONE: Upgraded browser-local history to v2 so every submitted single-page and
whole-site query is saved immediately, then updated in place through started,
failed, partial, or complete status. Existing v1 history migrates without data
loss. Scoreless failures remain visible and rerunnable; score sorting keeps
unscored queries after scored results. Clear-history removes both schema keys,
and Settings copy now accurately describes all-query capture. Gates:
lint/typecheck/build PASS, 237/237 tests, 18/18 Playwright journeys. Deployed as
`dpl_4zoEoyv5prto7mK57Hzao4gvU8vk`; a live blocked-network query appeared on
the dashboard as `failed` without scores, then the synthetic record was removed.

NEXT: No release work remains for this change.

CONTEXT: Current key `seo-ai-audit:history:v2`; legacy key is read only when v2
is absent. Query records remain compact and privacy-safe—no page content,
reports, provider responses, headers, or credentials are stored.

## 2026-07-19 · Dashboard card redesign and saved details · main

DONE: Redesigned every history row as a responsive audit card with prominent
status, mode, title/domain, average score, four-lens strip, and grouped actions.
Added an accessible native “View details” disclosure backed by history v3:
single audits retain bounded weakest-signal, blocker, question-gap, citation,
rewrite-count, word-count, and safe error summaries; site audits retain bounded
worst-page/common-finding/page-failure summaries. V1 and v2 records migrate
without loss and display a clear rerun prompt when no snapshot exists. Snapshot
arrays are capped at five and strings at 500 characters; full reports, fetched
content, raw provider responses, headers, and credentials remain unstored.
Gates: lint/typecheck/build PASS, 239/239 tests, 19/19 Playwright journeys,
including expanded-card overflow verification at 320px. Deployed as
`dpl_DDFCFqHo3rg2hhAGA258uxR9mydz`; Vercel reports Ready and the canonical
production alias is attached.

NEXT: No release work remains. The next newly completed audit will populate a
v3 snapshot; older migrated cards intentionally show the rerun prompt.

CONTEXT: Current key `seo-ai-audit:history:v3`; v2 and v1 are migration-only.
The redesign uses the existing Swiss/editorial tokens and native `<details>` /
`<summary>` keyboard behavior.

## 2026-07-19 · Reopen saved audit reports · main

DONE: Added a durable browser-local “Open report” flow for newly completed or
meaningfully partial single-page and whole-site audits. Full report state is
stored in versioned IndexedDB, while compact dashboard history moved to v4 and
keeps only an availability flag. `/report/[id]` renders the existing report UI
read-only; delete, clear-history, and retention-limit pruning also remove the
corresponding IndexedDB entries. V1–v3 history migrates without loss, and old
or failed summary-only entries remain rerunnable. Gates: lint/typecheck/build
PASS, 240/240 tests, 19/19 Playwright journeys including both saved-report
routes. Commit `8dfd666`; production deployment
`dpl_D6toD6tXPCmTfCsS3ZmvbYDwi2RW` is READY and aliased to the canonical URL.

NEXT: No release work remains for this change.

CONTEXT: Current history key `seo-ai-audit:history:v4`; report database
`seo-ai-audit:reports` version 1. Both stores are browser/device specific and
never synced to the server. If IndexedDB is unavailable, the compact history
record still works and offers Run again.

## 2026-07-19 · Cost-minimized Claude model · main

DONE: Replaced the default rewrite-tier `claude-sonnet-5` model with
`claude-haiku-4-5-20251001`, so direct Anthropic deployments now use Haiku 4.5
for both audit LLM calls. Updated the production `AI_MODEL` override to
`claude-haiku-4.5`, which applies the same cost-minimized choice to the current
OpenAI-compatible provider. Lint/typecheck/build and all 240 tests pass. Commit
`44e563a`; production deployment `dpl_6oNoLQwEGecFCLsFNiKqLW5CmsX3` is READY
and attached to the canonical alias.

NEXT: Monitor output quality on real audits; `AI_MODEL` can be changed without
a code release if a different cost/quality tradeoff is later preferred.

CONTEXT: Tier names remain `cheap` and `strong` because they also describe call
roles and mock fixtures, but both real default tiers now resolve to Haiku 4.5.

## 2026-07-19 · 500-record history pagination · main

DONE: Expanded the browser-local history setting from 10/25/50 to
10/25/50/100/250/500 audits. The dashboard now paginates filtered and sorted
results 10 cards at a time, shows the visible range and total, resets to page 1
when filters change, and safely clamps the current page after removals. Added a
browser journey covering the 12-record/two-page boundary. Gates:
lint/typecheck/build PASS, 240/240 tests, 20/20 Playwright journeys. Commit
`62689a9`; production deployment `dpl_4pNS6CLXZDKpp4iAwJLprdHqZz9p` is READY
and attached to the canonical alias.

NEXT: No release work remains for this change.

CONTEXT: The default history limit remains 25; users can select 500 in
Settings. Compact summaries stay in localStorage and reopenable reports stay
in IndexedDB, both browser/device specific.

## 2026-07-19 · Correct 500-record retention cap · main

DONE: Fixed the history writer's stale internal hard cap of 50 so the Settings
choice of 500 now genuinely retains up to 500 audit records. Added a regression
test with 550 inputs and a requested limit above the supported maximum to prove
the result clamps at exactly 500. Lint/typecheck/build PASS, 241/241 tests, and
5/5 focused dashboard browser journeys. Commit `ec4e4a0`; production deployment
`dpl_8UFWU1nMFoGdH2Qg2kFmkibWJc3Y` is READY on the canonical alias.

NEXT: No release work remains for browser history retention.

CONTEXT: This changes dashboard history retention only. The separate whole-site
audit crawler remains capped at 50 pages per run for provider-cost, timeout, and
anonymous abuse-control safety.

## 2026-07-19 · 500-page whole-site discovery cap · main

DONE: Raised whole-site audit discovery from default 30 / hard max 50 to a
default and hard maximum of 500 pages. Updated request validation, landing-page
copy, contract documentation, safety comments, and the hard-cap regression
test. Direct verification through the application discovery pipeline against
`www.orbix.studio` now returns all 200 sitemap URLs with `truncated: false`;
the site has 200 unique sitemap URLs and all returned HTTP 200 during the
pre-release check. Lint/typecheck/build PASS, 241/241 tests, 20/20 Playwright
journeys. Commit `a136842`; production deployment
`dpl_9iLhuU2QLks5ZLHRgeaoJ2p4QqZu` is READY on the canonical alias.

NEXT: Monitor real bulk runs for provider failures. The 240-second wall-clock
budget and partial-result reporting remain intentionally active.

CONTEXT: Discovery coverage and AI completion are separate. Production logs
from the earlier Orbix run showed rubric/rewrite provider errors; raising the
page cap includes all URLs but does not remove upstream provider limits or the
serverless wall-clock ceiling.

## 2026-07-19 · Individual retries for failed bulk pages · main

DONE: Added a “Retry page” action to every failed whole-site audit row and to
the drilled-in page error view. Recovery now routes only that URL through the
existing single-page `/audit` → `/api/audit` flow; it no longer restarts the
costly whole-site crawl. Site-level discovery errors retain the full “Run
again” action. Added an end-to-end journey proving the failed row navigates to
the individual audit and completes without another bulk request. Gates:
lint/typecheck/build PASS, 241/241 tests, 21/21 Playwright journeys. Commit
`a3361a7`; production deployment `dpl_ALmzJBLjr8xdBndVuF74xtgkz5pW` is READY
on the canonical alias.

NEXT: No release work remains for individual failed-page recovery.

CONTEXT: The successful individual retry is saved as a normal single-page
dashboard audit. The original saved site report remains an immutable snapshot;
rerunning one page does not rewrite that historical site rollup.

## 2026-07-20 · Supabase Phase 1 · main working tree

DONE: Implemented anonymous Supabase persistence for audit summaries,
reopenable reports, and settings using server-only routes, a random device
token hashed before storage, private RLS tables, local migration/offline
fallback, cloud/local recovery merge, and existing 500-record pagination.
Added Phase-2-ready provider-task and usage-ledger tables. Gates pass: lint,
typecheck, production build, 251 tests, and 21 Playwright journeys. Full report:
`docs/phases/supabase-phase1-report.md`.

NEXT: Push and deploy, then run a real audit to confirm `audit_runs` +
`audit_reports` rows and reopen the cloud report from the dashboard.

CONTEXT: The migration was applied successfully on 2026-07-20. Public probes
for all five new tables return HTTP 401 / PostgreSQL `42501`, confirming the
schema exists and publishable-key access is denied. The legacy `public.audits`
endpoint is present but empty and was not touched. Vercel reportedly has the
URL, publishable key, and rotated secret configured.

## 2026-07-20 · Supabase Phase 1 production activation · main@0a8e227+

DONE: Confirmed the URL, publishable key, and rotated secret are configured in
Vercel Production; deployed Phase 1 as
`dpl_9fZGF7ZoAiv24cgANxeoXy2uh2n6` and attached the canonical production alias.
The live `/api/history` route passed a zero-cost end-to-end audit write/read,
saved-report write/read, delete, and cleanup smoke test. The synthetic record
was removed, so validation left no test audit data behind.

NEXT: Run a normal production audit when useful to create the first user-owned
cloud report and confirm the browser's “Open report” presentation with real
content. Optional maintenance: remove stale pre-pivot Vercel variables.

CONTEXT: Production is https://seo-ai-audit-pied.vercel.app. Supabase public
table access remains denied by RLS; persistence is available only through the
server routes and ownership-token hash. Keep the rotated Supabase secret in
Vercel only and never expose it to client code or source control.

## 2026-07-20 · Cloud Phase 2 + Phase 5 completion pass · main working tree

DONE: DataForSEO technical crawl implementation is deployed with a hard
500-page cap, cost visibility, durable idempotent tasks, actual-cost ledger,
and saved-report pagination. Optional Supabase email-link account recovery is
implemented. The account migration and its rollback-only five-table ownership
test passed in production; Auth Site URL and dashboard redirect allowlist are
configured. Combined gates pass: lint, typecheck, production build, 270 tests,
and 22 Playwright journeys. Reports:
`docs/phases/dataforseo-phase2-report.md` and
`docs/phases/account-phase5-report.md`.

DEPLOYED: Commit `7b51ac2` is live as
`dpl_91Qtr94emxTMS7FnCZPBHygCZwTL`. Canonical HTML and the rendered browser
show the optional account drawer; anonymous history returned HTTP 200 and an
unverified account-link request returned HTTP 401 `invalid_session`.

NEXT: Final provider proof requires `DATAFORSEO_LOGIN` +
`DATAFORSEO_PASSWORD`; final cross-device proof requires a user-supplied email
address for the magic link.

CONTEXT: Do not send an unsolicited authentication email or invent provider
credentials. The database and UI work can ship independently; keep the overall
“complete all phases” goal active until both live proofs are performed.

## 2026-07-20 · Phase 5 live ownership validation · main

DONE: Used a reversible production Supabase test identity to save an anonymous
audit under device A, claim it into the verified account, recover it using a
different device B token, and delete it. Removed the test user and confirmed
zero `phase5-live-*` rows in `audit_runs`. This proves the production account
ownership and cross-device data path without touching user data.

NEXT: Configure custom SMTP for production email capacity. Supabase currently
shows the built-in two-emails-per-hour limit as disabled/read-only. Add the
still-missing DataForSEO API credentials (sandbox or live), then run the final
provider task.

CONTEXT: The free DataForSEO sandbox still requires the account API login and
API password. Set `DATAFORSEO_BASE_URL=https://sandbox.dataforseo.com` for a
zero-cost dummy-data validation before switching to the live hostname.

DEPLOYED: Account email error guidance commit `15f8e8b` is production-ready as
`dpl_CEr8AWNgehmbfsH1PMxgLi2Z1V7E` on the canonical alias.

## 2026-07-20 · DataForSEO production activation · main

DONE: Added the DataForSEO API login and password to Vercel as sensitive,
production-only variables and redeployed as
`dpl_HzvFEGHxypK9MGnLNEYM6RyEEg1t`. A real one-page production crawl of
`www.orbix.studio` completed with HTTP 200, an on-page score of 97.07, one
normalized page, and an actual provider cost of $0.00015 recorded in the
usage ledger. Deleted the synthetic audit after validation; its cost ledger
entry remains intentionally. Cloud Phase 2 is fully activated and validated.

NEXT: Configure custom SMTP in Supabase Auth and send one real magic-link email
to finish the production-email operator requirement. The reachable public URL
is now the stable project alias `https://seo-ai-audit-orbix2.vercel.app`;
`seo-ai-audit-pied.vercel.app` remains attached but routes to an edge pair that
timed out during validation.

CONTEXT: Supabase Authentication > Emails > SMTP Settings still shows
`Enable custom SMTP` off. Metadata and Supabase Auth URLs use the reachable
project alias. The app has no remaining DataForSEO credential or code blocker.
Do not expose or commit either provider secret.

## 2026-07-20 · One-click failed-page bulk recovery · main `a62bd3a`

DONE: Added a single “Retry failed pages” action to live and reopened
whole-site reports. The client sends only failed URLs through a new explicit
`pages` mode on `POST /api/audit/bulk`, preserves successful page results,
recomputes the combined rollup, and persists the merged report back to
IndexedDB and Supabase. The server skips discovery, deduplicates the list,
enforces the 500-page cap, and rejects cross-origin URLs. The existing
per-page “Retry page” link remains available.

GATES: Lint, TypeScript, production build, 273 unit/integration tests, and 24
Playwright journeys pass. Browser coverage proves the request excludes the
successful URL and that a reopened report keeps the merged result after reload.

DEPLOYED: Commit `a62bd3a` is live as deployment
`dpl_J1sAf2KJYWcPgTNPGH8uHNiYYbch` on
`seo-ai-audit-orbix2.vercel.app`. Production returned HTTP 200 and the explicit
retry route rejected a cross-origin page with HTTP 400 `invalid_url`, proving
the selective-retry validation is active without incurring provider spend.

NEXT: Use “Retry failed pages” on a production report when failures occur and
monitor provider/rate-limit behavior during large recovery batches.

CONTEXT: Explicit retry requests use `{ url, pages }`; they must not include
`limit`. Successful URLs are never submitted, so they incur no new LLM cost.
Custom SMTP remains the only unrelated operator configuration item.

## 2026-07-20 · Coordinator: platform program kickoff (F1 done) · main (local)

DONE: 4-agent parallel analysis (backend, frontend, SEO-domain, adversarial
critic) synthesized into `.claude/plan/seo-team-platform.md`. F1-CONTRACT
shipped: DATA-CONTRACT v1.2 §8 SkillTask envelope, §9 agent-mode hybrid runs,
§10 action plan, §11 Google connections/GSC/GA4, §12 insights. Decisions
D-014 (skill triage) through D-018 recorded. `scripts/db-wipe.sql` deleted
(D-018). claude-seo v2.2.0 installed locally (`~/claude-seo`,
`~/.claude/skills/seo*`) as reference implementation + usable `/seo*` tools.

NEXT: user pushes main, then launch executor sessions with the prompts below
(F2 first or parallel with W5/W3 — F2 blocks only the PAID parts of W1/W2).

CONTEXT: coordinator reviews every branch per COORDINATION.md; closing ritual
applies to every session below. Read before building:
`.claude/plan/seo-team-platform.md`, `docs/DATA-CONTRACT.md` §8–§12,
`docs/DECISIONS.md` D-014–D-018, `docs/ARCHITECTURE.md`, `PROJECT-STATUS.md`.

---

### Kickoff prompt — F2-BUDGET (model: Opus; branch `wsp-budget`)

You are implementing F2-BUDGET of the SEO-team platform program. Read
`.claude/plan/seo-team-platform.md` (Wave 0), `docs/DATA-CONTRACT.md` §8,
D-016, and `app/api/technical-audit/route.ts` + its migrations. Deliver:
(1) migration: budgets table + `reserve_spend`/`settle_spend` security-definer
RPC over usage_ledger (per-owner + global daily USD caps from env
`PROVIDER_OWNER_DAILY_USD`/`PROVIDER_GLOBAL_DAILY_USD`); add
`request_fingerprint` to provider_tasks + rebuild its unique index AND update
`claim_anonymous_workspace` in the same migration; (2) extract
`lib/providers/taskStore.ts` + `lib/providers/budget.ts` from the
technical-audit route, fixing the reservation-delete race (delete by primary
key, not the NULL-provider_task_id scan); (3) add per-IP rate limiting to
POST /api/technical-audit (reuse lib/audit/ratelimit.ts); (4) tests incl.
concurrent reservation + budget-denied (`budget_exceeded` per §8). Gates
green; closing ritual. Do not touch UI, Google, or new DataForSEO endpoints.

### Kickoff prompt — F3-OPS (model: Sonnet; branch `wsp-ops`)

You are implementing F3-OPS. Read the plan (Wave 0) + D-015. Deliver:
(1) a real `/privacy` page (data handling: audits, Supabase storage, optional
accounts, Google API Limited-Use disclosure, retention, deletion contact) —
required for Google OAuth verification; (2) `.env.example` additions
(`GOOGLE_CLIENT_ID/SECRET/OAUTH_REDIRECT_URL/TOKEN_ENC_KEY`,
`PROVIDER_*_DAILY_USD`); (3) a `docs/ops/google-verification.md` runbook with
the exact console steps + scope-justification draft for the user. Code is
small; most value is the runbook + policy page. Gates green; closing ritual.

### Kickoff prompt — W5-ACTION-PLAN (model: Sonnet; branch `wsp-action-plan`)

You are implementing W5-ACTION-PLAN. Read the plan (Wave 1) +
DATA-CONTRACT §10. Pure-TS synthesizer `lib/skills/actionPlan.ts`: map
existing `AuditFindings` (blockers/gaps), lens `capReason`s, site
`commonFindings`/`worstPages`, and DataForSEO `issueKeys` into
`ActionPlan` (≤50 items, severity-sorted, effort-tagged, bounded urls).
Render as a report section (compose SeverityChip/Card; adapt the dormant
`RoadmapPanel` if it fits) in single-page AND site reports + include in
export. Unit tests from fixtures; e2e extends mock-report spec. No new
providers, no LLM calls. Gates green; closing ritual.

### Kickoff prompt — W3-SHELL (model: Sonnet; branch `wsp-skill-shell`)

You are implementing W3-SHELL. Read the plan (Wave 1) + DATA-CONTRACT §8.
Generalize `app/components/audit/TechnicalSeoPanel.tsx` into a reusable
`SkillPanel` (explicit start button, provider-unavailable/budget-exceeded
states, poll loop, cost display) driven by any `SkillTask`; create
`lib/skills/mocks/` fixtures for 3 skills in all lifecycle states and a
dev-only `/dev/mock-skills` page rendering every state. Renderers may only
compose existing primitives (Card/Button/SeverityChip/ScoreTile/DiffHunk/
FindingsDrawer) — no new colors or status vocabularies. Gates green + axe on
the dev page; closing ritual.

### Kickoff prompt — W1-DFS (model: Sonnet; branch `wsp-dfs`; start after F2 merges or stub its helper)

You are implementing W1-DFS. Read the plan (Wave 1), DATA-CONTRACT §8, and
`lib/dataforseo/client.ts` (the pattern to clone). Add `serp.ts`,
`keywords.ts`, `backlinks.ts`, `labs.ts` over the shared transport (live
endpoints only, typed normalizers with row caps, cost from `task.cost`);
routes `app/api/skills/{serp,keywords,backlinks,labs}` implementing the §8
envelope, gated by `lib/providers/budget.ts` (stub with the F2 signature if
not merged). Mock tests mirroring `client.test.ts`. No UI. Gates green;
closing ritual.

### Kickoff prompt — W2-GOOGLE (model: Opus; branch `wsp-google`; needs F3's client id for live test, mock till then)

You are implementing W2-GOOGLE. Read the plan (Wave 1), DATA-CONTRACT §11,
D-015, and `supabase/migrations/202607200003*` (claim RPC). Deliver:
migration for `oauth_states` (single-use 256-bit nonce, 10-min TTL) +
`google_connections` (AES-256-GCM-encrypted tokens via `GOOGLE_TOKEN_ENC_KEY`,
server-only RLS, claim-RPC block in the SAME migration); routes
`/api/integrations/google/{start,callback,status,disconnect}` — connect
REQUIRES the verified bearer path (never device-only); `lib/google/tokens.ts`
(refresh, invalid_grant → status revoked); revoke-at-Google on disconnect;
purge on workspace delete. Tokens never in responses/logs. Unit tests with a
mocked Google token endpoint; SQL test for the claim path. Gates green;
closing ritual.

## 2026-07-20 · W5-ACTION-PLAN wrap-up (coordinator) · wsp-action-plan → main

DONE: Completed the stalled executor's W5 work per the user's "skip codex"
instruction. Action-plan synthesizer (`lib/skills/actionPlan.ts`, §10-exact,
15 unit tests) + `ActionPlanPanel` wired into single-page and site reports +
exports. Wrap-up fixes: `Card` gained a backwards-compatible `labelAs` prop
(accessible headings for report sections — future SkillPanels need this);
site-audit spec assertions scoped to heading roles (strict-mode collision
with action-plan prose); stale pre-pivot `.vercel/output` removed +
`.vercel/**` eslint-ignored (was 71 phantom lint errors). ALL GATES GREEN:
lint, typecheck, 288/288 unit, 25/25 e2e. Report:
`docs/phases/w5-action-plan-report.md`. Merged to local main.

NEXT: (1) user pushes main; (2) deploy + D-007 verify (action plan appears
on production reports); (3) next step-by-step workstream — recommended
order: F2-BUDGET (gates paid features; do NOT ship W1-DFS routes before it),
then W3-SHELL, then F3-OPS privacy/runbook.

CONTEXT: working step-by-step in this workspace (kinshasa), no separate
executor sessions for now. Push deny rule on `git push origin main` still
active — branch pushes are fine.

DEPLOYED: W5 is live — deployment `seo-ai-audit-a2zs7oks9` (Ready, 40s
build). D-007 verified: `/` HTTP 200 with real hero HTML, `/robots.txt` 200,
and the "Action plan" component confirmed present in the served /audit route
chunk (`24ta7n7bowfrz.js`).

## 2026-07-20 · F2-BUDGET (coordinator, step-by-step) · wsp-budget → main

DONE: Spend gate live in code: migration 202607200004 (request_fingerprint
idempotency + reserve_spend/cancel_spend RPCs + claim-RPC updated atomically),
lib/providers/{budget,taskStore}.ts extracted from the technical-audit route
(reservation-delete race fixed — delete by primary key), per-IP rate limit
added to POST /api/technical-audit (had NONE), budget_exceeded per §8.
No budgets table — caps are env (PROVIDER_OWNER_DAILY_USD=1,
PROVIDER_GLOBAL_DAILY_USD=10, 0=kill switch). Gates: lint/typecheck clean,
298/298 unit, build, 25/25 e2e. Report: docs/phases/f2-budget-report.md.

NEXT: ⚠️ APPLY MIGRATION BEFORE DEPLOYING (new code is deny-closed without
the RPC): run supabase/migrations/202607200004_spend_gate.sql in the Supabase
SQL editor, then deploy + validate one real crawl and one forced cap denial.
Then: Growth dashboard program G1→G5 per the approved plan
(~/.claude/plans/shimmying-launching-elephant.md).

CONTEXT: W1-DFS must route every paid call through reserveSpend + taskStore
(that's the point of F2). Env caps to add in Vercel when convenient.

## 2026-07-20 · G1 growth overview (coordinator) · wsp-growth-1 → main

DONE: /dashboard = Growth (default) + History tabs; per-domain progress cards
with score deltas, sparklines, needs-attention strip — all client-computed
from existing history (zero backend). lib/growth/aggregate.ts pure + 8 tests.
Technical-crawl→action-plan seam wired (issueKeys now in site plans). Gates:
lint/typecheck ✓, 306/306 unit, build ✓, 30/30 e2e (4 pre-existing specs
updated for the new default tab). Report: docs/phases/g1-growth-overview-report.md.

NEXT: G2 tracked sites + daily DET snapshots per the approved plan — to run
under the multi-agent model (.claude/plan/multi-agent-growth-execution.md).
User actions still open: push main, apply migration 202607200004 BEFORE any
deploy, then deploy.

CONTEXT: growth components read-only over history; History tab owns writes.

## 2026-07-20 · G2 tracked sites + daily snapshots (multi-agent pipeline) · wsp-growth-2 → main

DONE: Full 5-stage pipeline: §13 contract + migration 202607200005 (stage 0),
2 parallel worktree build agents (api ∥ ui, zero conflicts), converge, 3
adversarial reviewers (security/design/coverage), all findings fixed via 2
more parallel test agents + coordinator fixes (nulls-last fairness, 500-site
capacity gate, idempotent re-track, midnight day-key, a11y polish, orphan-
tracked card). Gates: 356/356 unit, 39/39 e2e. Report:
docs/phases/g2-tracked-snapshots-report.md; D-020 recorded.

NEXT: (1) user pushes main; (2) BEFORE deploy: apply migration 202607200005
in Supabase + set CRON_SECRET in Vercel; (3) deploy + D-007 verify (growth
tab tracking toggles live; hit /api/cron/snapshots once with the secret to
smoke the collector); (4) next phase per plan: G3 site hub + skills.

CONTEXT: cron schedule 0 3 * * * UTC in vercel.json; free DET-only (D-019);
capacity + fairness rationale in D-020.

DEPLOYED: G2 live-validated on seo-ai-audit-orbix2.vercel.app — / 200,
dashboard serves Growth overview, tracked-sites + cron both 401 unauthenticated
(deny-closed auth proven), and post-migration probe returned {"sites":[]} 200,
confirming 202607200005 is applied. CRON_SECRET rotated + baked into the live
deployment; first scheduled snapshot run: 03:00 UTC tonight.

---

## 2026-07-21 (am) — coordinator: audit-reliability fix + public share links

**Done**
- **Retry/queued fix** (branch `wsp-audit-reliability`): pages the 240s site
  wall-clock budget never started had no state entry, so both retry selectors
  (`phase === "error"`) skipped them forever and the UI showed a permanent
  "Queued". Selectors now include any non-done page
  (`useSiteAuditStream.ts`, `SavedReportClient.tsx`); the settled view labels
  no-entry pages "Not started"; the button reads "Retry N remaining pages"
  and the stopped-early banner points at it. Zero backend change — the
  `pages` retry mode already accepted arbitrary lists. New reducer unit test
  (never-started page → retried → done) + budget-expiry e2e journey.
- **Public share links** (same branch, DATA-CONTRACT §14, D-021): opt-in,
  revocable `/s/<token>` links to STORED reports. Migration
  `202607210006_share_links.sql` (`share_links` table, RLS zero-grant,
  claim-RPC recreated with link migration), `POST/DELETE /api/share`
  (owner-authed, rate-limited, mint-or-reuse 128-bit hex token), public
  server page `app/s/[token]` rendering the stored report read-only via
  `SharedReportView`, `ShareLinkButton` on saved reports. Persistence audit
  confirmed `autoSaveAudits` defaults true and every run state (complete /
  partial / stopped-early / failed) already reaches Supabase.
- Gates: lint ✅ typecheck ✅ 366 unit ✅ 41 e2e ✅ build ✅.

**Next**
1. USER: apply `202607210006_share_links.sql` in Supabase SQL editor.
2. USER: push main (`env -u GH_TOKEN git push origin main`).
3. Deploy + D-007 smoke: open a saved report → Copy public link → open
   `/s/<token>` in a private window (no owner header) → report renders;
   DELETE the link → page shows "Link unavailable".
4. G3 (site hub + skill panels + agent runs) remains next in the growth plan.

**Context**: share links deliberately opt-in (D-021 — public-by-default would
leak what users audit). D-006 stateless re-run share link unchanged on live
runs. The e2e covers the button flow; the public page render is unit-tested
(`loadSharedReport`) and needs the live smoke because Playwright can't mock
server-side Supabase.

---

## 2026-07-21 (am) — coordinator: deploy + live validation (fix-pack + share)

Deployed `main@17cba6a` to production via Vercel CLI (deployment
`seo-ai-audit-fxd8vtqfb-orbix2.vercel.app`, promoted to the
seo-ai-audit-orbix2.vercel.app alias). D-007 smoke, all green over real HTTP:

- `/s/<invalid>` and `/s/<unknown-32hex>` → "Link unavailable" (200, noindex).
- Throwaway workspace: `PUT /api/history` → `{"saved":1,"reportSaved":true}`
  (report persisted in Supabase), `POST /api/share` → token minted — proves
  migration `202607210006` is applied in production.
- Public `GET /s/<token>` with NO owner header rendered the stored report
  ("Shared report … read-only", `robots: noindex,nofollow`).
- Re-POST returned the SAME token (idempotent); `DELETE` → `{"ok":true}`;
  the revoked link now renders "Link unavailable".
- `/audit/site` serves 200 on the new bundle (retry fix is client-side,
  covered by the 41-journey e2e suite pre-deploy).

残: smoke left one tiny orphaned audit row under a throwaway owner (same as
prior probes — harmless). Main still needs the user push
(`env -u GH_TOKEN git push origin main`). Next phase: G3.

---

## 2026-07-21 (am/pm) — coordinator: G3 site hub

**Done**
- Investigated G3's prerequisites before implementing (Explore agent +
  direct checks): W3-SHELL (SkillPanel) and W7-AGENT (orchestrator) are both
  genuinely unbuilt — zero code, only DATA-CONTRACT §8/§9 spec text. Recorded
  the scope adjustment as D-022 rather than silently shipping less than the
  plan promised.
- Shipped `/site/[host]` (branch `wsp-g3-site-hub`): one domain's growth
  trend, tracked-site toggle, current action plan, technical crawl panel,
  and audit history — composing only pieces that already exist (zero new
  API routes, zero new migrations). New: `lib/growth/burndown.ts` (issue
  trend + exact resolved/new diff between the two latest full reports),
  `app/hooks/useMergedHistory.ts` (extracted from `GrowthOverview`, reused by
  both), `app/components/growth/LensScoreGrid.tsx` (extracted from
  `SiteGrowthCard`, reused by both).
- Adversarial code-reviewer pass found 1 HIGH + 3 MEDIUM, all fixed:
  action-plan item ids were positional (`common-${i}` etc.) rather than
  content-derived, which silently broke the "N resolved · M new" diff
  whenever `commonFindings`' count-sort reordered issues between audits —
  fixed with a `stableId()` helper in `lib/skills/actionPlan.ts`, plus
  regression tests at both the unit level (through real `actionPlanForSite`
  output) and e2e level (asserting the rendered caption) that didn't exist
  before. Also fixed two narrower state-staleness gaps
  (`technicalPages`/`dailySeries` not resetting on record/domain change).
- Gates: lint ✅ typecheck ✅ 375 unit ✅ 46 e2e ✅ build ✅. Merged to `main`
  locally.

**Next**
1. USER: push main (`env -u GH_TOKEN git push origin main`).
2. Say "deploy" and I'll ship it + run the D-007 smoke (open `/site/<a
   domain you've audited>` in production, confirm the hub renders).
3. G4 (GSC/GA4 daily ingestion) is next in the growth plan — depends on
   W2-GOOGLE (OAuth vault), still queued.

**Context**: the fixed `stableId()` helper changes `ActionItem.id` values
for blockers/question-gaps/common-findings across the whole app (not just
the new hub) — this is a bug fix, not a breaking contract change (§10 never
promised a specific id format, only that ids exist), but worth knowing if a
future session sees action-plan ids that look different from before.

---

## 2026-07-21 (pm) — coordinator: G3 deploy + live validation

Deployed `main@4541794` to production (`seo-ai-audit-nnjieptmo-orbix2.vercel.app`,
promoted to the `seo-ai-audit-orbix2.vercel.app` alias). D-007 smoke, real
browser against the live URL (curl alone can't drive `SiteHubClient` — it's
client-rendered and reads the owner token from `localStorage`):

- Seeded a throwaway owner's history + saved reports for a synthetic
  `g3-smoke.example` domain (2 site audits, matching the exact regression
  fixture from `test/e2e/site-hub.spec.ts`) via `PUT /api/history`.
- Real Chromium session (owner token set in `localStorage`, DNS pinned to
  Vercel's IP the same way the sandbox's curl needs `--resolve`) navigated to
  `/site/g3-smoke.example` and confirmed: domain heading, "2 audits", the
  `+20` delta chip, all 4 lens scores, the "Issues found per audit" burndown
  card, and — the important one — **"Since the previous audit: 2 resolved ·
  1 new"**, exactly the correct output the `stableId()` fix was supposed to
  produce (proving the HIGH-severity id-stability bug is genuinely fixed in
  production, not just in tests). Action plan correctly showed only the
  LATEST report's finding ("Thin content"). Technical crawl panel mounted
  and was actively checking status. Audit history listed both records with
  working "Open report" links.
- Spot-checked the other two recent features are still healthy: share-link
  mint → public view (no owner header) → revoke round-tripped clean;
  `/audit/site` (retry-fix surface) serves 200.
- All smoke artifacts (temp scripts, owner token file, JSON payloads)
  cleaned up after.

残: the smoke leaves one throwaway domain's history/reports/share-link under
a discarded owner token in production Supabase (same harmless-residual
pattern as every prior smoke this project). No further action needed.

**Next**: G4 (GSC/GA4 daily ingestion) — blocked on W2-GOOGLE (OAuth vault),
still queued; needs the user's Google Cloud OAuth app + consent screen work
(F3-OPS) before it can start.

---

## 2026-07-21 (pm) — coordinator: skills wave SK0+SK1 (plan approved, executing)

**Done**
- Plan for the skills + agent-mode wave approved (supersedes D-022's
  deferral; D-023). Scope: W3-SHELL + W4-DET-SKILLS + W1-DFS paid data +
  full W7 orchestrator + W8 compare subset. All build agents Sonnet (user
  directive); coordinator reviews per phase.
- SK0 (`11f60d2`): claude-seo reference pulled 2.2.0→2.2.4; DATA-CONTRACT
  v1.5 (`ai-access` SkillId, §8.1 typed result payloads, `planOnly` agent
  request flag); `lib/skills/types.ts` (the shared law); `extraItems` seam
  in buildActionPlan; D-023.
- SK1 (`63d42c4`): two parallel Sonnet worktree agents, zero converge
  conflicts. BE: five $0 deterministic skills (schema/sitemap/hreflang/
  images/ai-access) as complete-inline §8 routes over the existing SSRF
  stack + 156 tests. FE: SkillPanelView/SkillPanel (TechnicalSeoPanel
  generalized), StatGrid, 10 typed renderers, SKILL_REGISTRY (all disabled
  until live smokes), per-skill mocks, mockAgentRun scripts,
  /dev/mock-skills design-gate page (its 320px spec caught + root-caused a
  real flex overflow). Gates: 573 unit / 51 e2e / lint / typecheck / build.
- SK2 launched (in flight): BE = serp/keywords/labs/backlinks DFS modules +
  paidSkillRunner + budget-gated routes; FE = useAgentStream + agent
  confirm-gate UI + /audit/agent (mock-first, NODE_ENV-gated radio).

**Next**
1. Converge SK2 → gates → merge; then SK3 (orchestrator + agent_runs
   migration + hub mounting + coordinator adversarial review), SK4
   (compare + wave wrap + deploy).
2. USER: push main when convenient; deploy happens on "deploy" after the
   wave (or per-phase if requested). Registry flags flip per skill only
   after live deploy smokes.

**Context**: direct Agent-tool builds are blocked by an AI Team OS hook —
build agents run through the Workflow tool (established G2 precedent).
SK1-BE notes for SK3: each runSkill module is directly callable by the
orchestrator for inline completions; routeHelpers' constructors are the
envelope factories. SK1-FE notes: SkillPanel's initialTaskId prop is the
handoff/reopen mode the agent report embeds.
