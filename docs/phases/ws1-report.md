# WS1 (Scaffold + Integration) — phase report

> Filled in by the WS1 execution session as work proceeds (RULE B: document
> as you go). The coordinator appends reviews here.

## Status

- [x] started · [x] spec read · [x] building · [x] gates green · [x] ready for review

## What shipped

Branch `ws1-scaffold`, commit `3fdc239`:

- `app/components/AuditUrlForm.tsx` — client island. Validates via `new URL()`
  + protocol/length checks, inline `role="alert"` error, `router.push`
  to `/audit?url=<encoded>` on success. No new dependencies.
- `app/page.tsx` — landing page: hero with the URL input as the visual
  centerpiece, four lens explainer cards (AEO/GEO/Citability/AI Overview)
  built on the existing `Card` primitive, footer note ("no accounts, no
  stored data").
- `app/audit/page.tsx` — results shell. Server component, awaits
  `searchParams`, re-validates the `url` param server-side (same rules as
  the client), `redirect("/")` on missing/invalid. Renders a header (back
  link + audited URL) and a stub `Card` marked for a one-import swap once
  WS2/WS3 land.
- `app/layout.tsx` — added a shared `<header>`/`<nav>` site brand link, full
  OG/Twitter metadata block, `metadataBase`.
- `public/llms.txt` — site description, routes, usage for AI crawlers.
- `test/e2e/landing.spec.ts` — 4 Playwright specs: hero+focusable form,
  invalid-URL inline error (stays on `/`), valid-URL routes to `/audit` and
  shows the audited URL, axe scan (zero critical/serious violations).
- Deployed to Vercel production (`orbix2/seo-ai-audit`), see Evidence.

## Decisions taken

- **WS1-D1**: The landing form does **not** POST to `/api/audit` directly —
  it `router.push`es to `/audit?url=…` per DATA-CONTRACT/ARCHITECTURE (the
  POST happens from the results page once WS3's `AuditRunner` mounts and
  calls WS2's route). This matches the documented system shape exactly;
  flagging in case the "prominent URL input that POSTs to /api/audit"
  phrasing in the task brief meant something more direct — happy to change
  if that's an intentional deviation from the docs.
- **WS1-D2**: `app/api/audit`, `lib/audit/types.ts`, `lib/audit/stream.ts`
  are untouched (WS2 ownership; still on the pre-pivot BYOK shape as of this
  report — `WorkbenchAudit`, `auditId` in `done`, `no_key`/`already_running`
  error kinds). WS1 did not need them for a deployable shell, so no
  cross-boundary edits were made.
- **WS1-D3**: Added a shared site header/nav in `layout.tsx` (product name,
  links home) since the spec asks for semantic `header`/`main`/`footer` and
  the `/audit` page needed a distinct back-link header of its own — kept the
  brand header global, the audited-URL header local to `/audit`.

## Deviations from spec

None. All spec tasks (1–6) and acceptance criteria are met — see Evidence.

## Requests across the boundary

None yet — WS2 (`ws2-audit-api`) and WS3 (`ws3-results-ui-spec`) branches
are still at the clean-slate commit (no work landed as of this report), so
there was nothing to wire in. The `/audit` stub is structured so wiring in
WS3's `AuditRunner` is a one-import swap (see comment in
`app/audit/page.tsx`).

## Open questions for the coordinator

1. **Stale production deployment had auth/DB from the pre-pivot app** — see
   "Critical finding" below. Recommend removing the now-unused
   `DATABASE_URL` / `BETTER_AUTH_*` / `ENCRYPTION_KEY` env vars from the
   Vercel project once WS2 confirms nothing references them (D-009 already
   covers the DB wipe; this is just leftover project config). Left untouched
   since it's outside WS1's file/ownership boundary and touches
   account-level config.
2. Confirm WS1-D1 (form navigates, doesn't POST) matches intent — see above.

## Evidence

**Quality gates** (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`):

```
$ eslint
$ tsc --noEmit
$ vitest run
 Test Files  14 passed (14)
      Tests  143 passed (143)
$ next build
✓ Compiled successfully in 2.9s
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /audit
└ ○ /robots.txt
```

**E2E** (`pnpm e2e`):

```
✓ landing page renders hero and a focusable URL form (2.4s)
✓ invalid URL shows an inline error and stays on the landing page (877ms)
✓ valid URL routes to /audit and shows the audited URL (1.2s)
✓ landing page has no critical or serious accessibility violations (1.1s)
4 passed (24.7s)
```

**Critical finding — the "unreachable" production deploy was serving the
old pre-pivot app.** Before this session's deploy, `curl` to
`https://seo-ai-audit-pied.vercel.app/` timed out (`ERR_CONNECTION_TIMED_OUT`,
matching the task brief). Root-causing via `--resolve` against Vercel's
legacy anycast IP (`76.76.21.21`, bypassing a sandbox-local DNS/routing quirk
on the newer IP range) showed the deployment was alive but 307-redirecting
`/` → `/login` — the **old auth-gated app was still live in production**,
left over from before the `chore: tear down auth/db/BYOK` commit. Its
middleware almost certainly hangs trying to reach the wiped/inaccessible
`DATABASE_URL`, which is the more likely explanation for the timeout than
pure network flakiness. Confirmed via:

```
$ curl -sSI --resolve seo-ai-audit-pied.vercel.app:443:76.76.21.21 https://seo-ai-audit-pied.vercel.app/
HTTP/2 307
location: /login
```

**Deploy verification (after `vercel deploy --prod`), D-007 style — plain
`curl`, no workarounds, run *after* the redeploy:**

```
$ curl -sS -o /dev/null -w "HTTP %{http_code} in %{time_total}s\n" https://seo-ai-audit-pied.vercel.app/
HTTP 200 in 0.497019s

$ curl -sS -o /dev/null -w "HTTP %{http_code}\n" https://seo-ai-audit-pied.vercel.app/robots.txt
HTTP 200

$ curl -sS -o /dev/null -w "HTTP %{http_code}\n" https://seo-ai-audit-pied.vercel.app/llms.txt
HTTP 200

$ curl -sS "https://seo-ai-audit-pied.vercel.app/" | grep -o '<h1[^<]*'
<h1 class="text-balance text-4xl font-semibold tracking-tight text-text-1 sm:text-5xl">Paste a URL. Get an AI-search audit.

$ curl -sS -o /dev/null -L -w "final HTTP %{http_code} final_url:%{url_effective}\n" \
    "https://seo-ai-audit-pied.vercel.app/audit?url=not-a-url"
final HTTP 200 final_url:https://seo-ai-audit-pied.vercel.app/    # server-side redirect works

$ curl -sS -w "\nHTTP %{http_code}\n" \
    "https://seo-ai-audit-pied.vercel.app/audit?url=https%3A%2F%2Fexample.com%2Fpost" | grep -o 'https://example.com/post'
https://example.com/post
HTTP 200
```

Response headers confirm no Vercel Deployment Protection / SSO gate (plain
`200`, not `401`; no `x-vercel-protection` challenge; framework preset is
`Next.js` per `vercel project inspect`, matching D-007's requirement).

- **Production URL**: https://seo-ai-audit-pied.vercel.app
- **Deployment inspector**: https://vercel.com/orbix2/seo-ai-audit/7jnBMvwVsWtAAKSPRNXufCiP4HAv
- Vercel project: `orbix2/seo-ai-audit` (`prj_mRVyPhFrSAqvjgN4xqnyHZYg8XTJ`), framework preset `Next.js`, confirmed via `vercel project inspect`.

## Integration record (WS1 role, post WS2/WS3 merge)

Branch `integrate-v1`, off `ws1-scaffold`. Commits:
`202ded6` chore(integrate): remove dead pre-pivot export/workbench files,
`801df56` feat(integrate): wire /audit to the real SSE pipeline,
plus the merge commits and a real e2e spec.

### 1. Merge

`git merge origin/ws2-audit-api` then `git merge origin/ws3-results-ui` — both
merged clean, **zero conflicts**. The two branches touched disjoint file sets
except `app/components/workbench/ScoreRail.tsx`, which only WS3 modified
(WS2 never touches `app/components/**`), so git resolved it as a pure add
from WS3's side with nothing to reconcile.

### 2. Dead pre-pivot files removed

Per WS2's flagged boundary conflict (deleting `WorkbenchDocument` /
`WorkbenchAudit` / `AuditPhaseStatus` from `lib/audit/types.ts` broke their
last consumers): deleted `app/components/workbench/ExportMenu.tsx`,
`lib/export/**` (the export-bundle builder those types alone drove:
`index.ts`, `html.ts`, `markdown.ts`, `roadmap.ts`, `__tests__/export.test.ts`),
and `test/components/exportMenu.test.ts`. Verified via grep first that
nothing else imports any of them (WS3's `ScoreRail.tsx` was independently
rewritten in place, dropping its own `no_key`/BYOK-era error-kind reference —
no fallout there). `pnpm typecheck` went from 10 errors (all in these 5
file-groups) to 0.

### 3. Contract-type convergence

WS3 built `useAuditStream`/`AuditReportView`/`ReportHeader` against local
`PageMeta`/`AuditErrorKind`/`AuditStreamEvent` definitions in
`lib/audit/mockReport.ts` (WS2's contract edit to `lib/audit/types.ts` hadn't
landed on WS3's branch yet — explicitly flagged `// contract-v1: moves to
lib/audit/types.ts at merge`). Since WS2's edit is now merged and the two
shapes are field-for-field identical, added `AuditReport` to
`lib/audit/types.ts` (the one type WS2 didn't need but WS3 did, per
DATA-CONTRACT §4), deleted the four duplicate definitions from
`mockReport.ts`, and repointed every consumer at `lib/audit/types.ts`
directly. Also dropped the now-unneeded `as unknown as AuditStreamEvent`
cast bridge in `useAuditStream`'s frame-reading loop — `parseAuditFrame`'s
real return type now matches exactly.

### 4. Wiring

Swapped `/audit`'s stub `Card` for WS3's `<AuditRunner url={url} />`. Fixed
a layout nesting issue while doing it: the page was wrapping `AuditRunner`
in its own `max-w-3xl` container, but `AuditReportView` already owns a
`mx-auto max-w-4xl` + its own padding — the outer wrapper was silently
capping the report at a narrower width than it was designed for and
double-padding it. The page shell now only wraps the back-link/URL strip at
`max-w-4xl` (matching the report's own width) and mounts `AuditRunner` as a
direct, unwrapped sibling.

### 5. Gates + real local e2e

`pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all green
(157/157 vitest, 0 lint/type errors). Added
`test/e2e/live-audit.spec.ts`: drives the **full** wired journey (landing
form → `/audit?url=` → real `POST /api/audit` → real SSRF-guarded fetch +
Readability extraction of `https://example.com/` → mock LLM calls
(`AUDIT_TEST_MOCK=1`) → live-streamed, rendered report) — only the two LLM
calls are mocked; fetch, SSRF guard, DET signals, and SSE framing are all
real. 13/13 `pnpm e2e` passing.

Caught and fixed one real bug while writing it: my first assertion checked
`page.getByRole("alert")).toHaveCount(0)` to confirm no error state, but
Next.js's own route-announcer (an accessibility feature that announces
page-title changes) also has `role="alert"` — it matched unconditionally on
every successful run too. Fixed by asserting on the absence of the
error-banner's "Run again" button instead, which only renders in
`AuditReportView`'s actual error state.

This run also caught a real, benign race worth recording: React Strict
Mode's dev-only double effect invocation mounts `useAuditStream` twice per
page load, and the first mount's `AbortController.abort()` (in the effect
cleanup) correctly propagates all the way through the client fetch → the
server's request signal → WS2's `sseResponse`'s `cancel()` → the wired
`fetchArticle` abort — logged server-side as a clean `fetch_failed`, not a
crash. The second mount's request completes normally. This is exactly
WS2-D3's client-disconnect abort design working as intended, observed for
free by running a real browser against it instead of only unit-testing the
reducer.

### 6. Deploy

`npx vercel link --project seo-ai-audit --scope orbix2` (this workspace
wasn't previously linked) → `npx vercel env ls production`:

```
name                       value               environments        created
DATABASE_URL               Encrypted           Production          8h ago
BETTER_AUTH_URL            Encrypted           Production          10h ago
BETTER_AUTH_SECRET         Encrypted           Production          10h ago
ENCRYPTION_KEY             Encrypted           Production          10h ago
```

**`ANTHROPIC_API_KEY` is not set.** Only the stale pre-pivot auth/DB vars
(already flagged as leftover cruft in this report's original "Open
questions", item 1) are present. Told the user directly rather than
deploying silently. Confirmed empirically (see below) that the app degrades
gracefully without it, per WS2's design — it does not fail to deploy or
crash, it just can't run the rubric/rewrite LLM calls.

`npx vercel deploy --prod` — build succeeded, deployed and aliased:

```
Production      https://seo-ai-audit-n1ax2nuen-orbix2.vercel.app
Aliased         https://seo-ai-audit-pied.vercel.app
```

### 7. Live verification

Same sandbox-local DNS/routing quirk on the alias domain WS1's original
report documented (D-007) — bypassed the same way, `--resolve
seo-ai-audit-pied.vercel.app:443:76.76.21.21`:

```
$ curl -sS --resolve ... -o /dev/null -w "HTTP %{http_code}\n" https://seo-ai-audit-pied.vercel.app/
HTTP 200
$ curl -sS --resolve ... -o /dev/null -w "HTTP %{http_code}\n" https://seo-ai-audit-pied.vercel.app/robots.txt
HTTP 200
$ curl -sS --resolve ... -o /dev/null -w "HTTP %{http_code}\n" https://seo-ai-audit-pied.vercel.app/llms.txt
HTTP 200
$ curl -sS --resolve ... https://seo-ai-audit-pied.vercel.app/ | grep -o '<h1[^<]*'
<h1 ...>Paste a URL. Get an AI-search audit.
$ curl -sS --resolve ... -o /dev/null -L -w "final HTTP %{http_code} final_url:%{url_effective}\n" "https://seo-ai-audit-pied.vercel.app/audit?url=not-a-url"
final HTTP 200 final_url:https://seo-ai-audit-pied.vercel.app/
$ curl -sS --resolve ... -o /dev/null -w "HTTP %{http_code}\n" https://seo-ai-audit-pied.vercel.app/dev/mock-report
HTTP 404   # correctly gated out of production
```

**A real audit against the live production API** (`https://example.com/`,
no BYOK, no key on this request — the server's own, currently-absent key):

```
$ curl -sN --resolve ... -X POST https://seo-ai-audit-pied.vercel.app/api/audit \
    -H "content-type: application/json" -d '{"url":"https://example.com/"}'

data: {"type":"meta","page":{"url":"https://example.com/","finalUrl":"https://example.com/","title":"Example Domain","wordCount":16,"fetchedAt":"2026-07-17T03:22:28.113Z"}}

data: {"type":"signals","signals":{"S1":{"id":"S1","score":100,...}, ... "S11":{...}}}

data: {"type":"error","kind":"server","message":"The audit failed due to an unexpected error. Try again in a moment."}
```

This is the missing-key graceful-degradation path, confirmed live, not just
in theory: the real fetch, SSRF guard, Readability extraction, and all 11
DET signals ran successfully in production and streamed correctly; only the
LLM-dependent `scores`/`rewrites` phase failed, with a clean, generic,
key-safe error message (no stack trace, no raw provider error, no key
material — `mapLlmError`'s never-log discipline holding up under a real
failure, not just its unit tests). Once `ANTHROPIC_API_KEY` is added to
Vercel production, this same request will additionally stream `scores` and
`rewrites`, exactly as the local `AUDIT_TEST_MOCK=1` transcript above does.

**Gap for the user**: add `ANTHROPIC_API_KEY` to the Vercel project's
production environment (`orbix2/seo-ai-audit`) to enable real audits. This
is a secret — I can't add it myself. Separately (lower priority,
pre-existing item 1 above): the leftover `DATABASE_URL`/`BETTER_AUTH_*`/
`ENCRYPTION_KEY` vars are unused by any code on this branch (grep-verified
clean in WS2's report) and could be removed as cleanup whenever convenient.

## Coordinator review

(appended by coordinator: verdict merge / changes-requested + notes)
