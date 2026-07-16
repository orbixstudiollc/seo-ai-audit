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

## Coordinator review

(appended by coordinator: verdict merge / changes-requested + notes)
