# WS4 (Bulk Audit + Site Crawl) — phase report

> Filled in by the WS4 execution session as work proceeds (RULE B: document
> as you go).

## Status

- [x] started · [x] spec read · [x] building · [x] gates green · [x] ready for review

## What shipped

Branch `ws4-bulk-audit-crawl` (the workspace's actual branch name — see
"Deviations" below), on top of `integrate-v1`. Five pieces, in dependency
order:

### 1. SSRF pinned-IP dispatcher (prerequisite, closes the WS2-review gap)

`lib/import/ssrfGuard.ts`'s `assertSafeUrl`/`validateRedirectHop` now return
`{ url, dispatcher }` instead of a bare `URL`. `dispatcher` is an `undici
Agent` whose `connect.lookup` is overridden to hand back the **exact**
address that was already validated, regardless of what hostname the
connector is asked to resolve at connect time. `fetchArticle.ts` and the new
`lib/import/safeFetch.ts` fetch exclusively through this dispatcher, closing
the DNS-rebinding TOCTOU the WS2 report flagged (`docs/phases/ws2-report.md`
line 222: *"a fully pinned resolved-IP dispatcher is the upgrade path if
TOCTOU DNS rebinding within a single hop ever matters"* — it matters now
that discovery multiplies fetch surface). New dependency: `undici@^7.28.0`
(pinned to the 7.x line — Node 25's own bundled `undici` is 7.18.2, and the
`dispatcher` fetch option requires the npm package's `Dispatcher` interface
to match Node's internal one; `undici@8.x` throws `UND_ERR_INVALID_ARG` at
the handler layer — verified empirically, see Evidence).

`lib/import/safeFetch.ts` is a new, smaller, content-type-agnostic guarded
fetch (same pinned-dispatcher + per-hop revalidation policy, no HTML-only
assumptions) that discovery uses for robots.txt/sitemap.xml/crawled pages.
`fetchArticle.ts`'s own timeout/byte-cap/redirect-loop structure was left
untouched beyond threading the dispatcher through — deliberately not
refactored into `safeFetch.ts` to keep the diff on that tested, WS2-owned
file minimal (see Decisions).

Test-only escape hatch `AUDIT_TEST_ALLOW_LOOPBACK=1` (same pattern as the
existing `AUDIT_TEST_MOCK=1`) lets discovery/bulk fetch a local fixture HTTP
server in tests; it narrowly bypasses the loopback-literal block only, never
widens to other private ranges, and is never set outside
`playwright.config.ts`'s webServer env and test setup.

### 2. Discovery (`lib/discovery/`)

- `sitemap.ts` — `origin/sitemap.xml` + one level of sitemap-index nesting
  (capped at 5 children), regex `<loc>` extraction (no new XML dependency).
- `robots.ts` — minimal `User-agent: *` `Disallow`/`Allow` parser
  (longest-prefix-match), fails open (allow-all) on any fetch/parse failure.
- `linkCrawl.ts` — same-origin, robots-respecting, breadth-first HTML link
  crawl, bounded by `maxDepth` (2) and `maxPages`.
- `discoverPages.ts` — orchestrator: sitemap first, falls back to the crawl
  when the sitemap is missing/empty (only the root survived filtering),
  normalizes + dedupes + same-origin-filters + robots-filters, caps at
  `limit` (default and hard max 500 — `DISCOVERY_DEFAULT_LIMIT`/
  `DISCOVERY_HARD_MAX`).

Every fetch discovery makes goes through `safeFetchText` — same SSRF pin as
above, so robots.txt/sitemap.xml/every crawled page is guarded, not just the
root URL.

### 3. Shared per-page pipeline (`lib/audit/pageAudit.ts`)

Extracted the fetch → extract → DET signals → rubric call → rewrite call
body straight out of `app/api/audit/route.ts` into `runPageAudit()`, byte-
identical logic, same event sequence. The single-page route now just calls
it once; the bulk route calls it once per discovered page. There is one
implementation of the pipeline, not two that could drift.

Also extracted `lib/audit/httpHelpers.ts` (`jsonError`/`clientIp`, identical
in both routes before) and generalized `lib/audit/stream.ts`'s SSE
responder into `createSseResponse<E>(formatEvent, run)` (same heartbeat/
close-once/abort-wiring the single-page route already had, now shared
instead of duplicated). `formatAuditEvent`/`parseAuditFrame`/`HEARTBEAT_FRAME`
are untouched; the generic responder and the new
`formatSiteAuditEvent`/`parseSiteAuditFrame` are additive.

### 4. Abuse/cost controls + rollup (`lib/audit/siteGuards.ts`, `siteRollup.ts`)

- Per-IP: 1 concurrent crawl (`acquireCrawlSlot`/`releaseCrawlSlot`, an
  in-memory mutex Set), 2/hour + 5/day (`checkBulkRateLimit`, reusing
  `ratelimit.ts`'s bucket — much stricter than the single-page route's
  5/min + 20/day, since one crawl is worth dozens of single audits in spend).
- Total fetch/page budget: discovery's own `limit`/`DISCOVERY_HARD_MAX` cap.
- Wall-clock budget: `createSiteBudget(240_000)` — `runConcurrentQueue` stops
  starting new pages once expired, lets in-flight pages finish, reports
  `stoppedEarly`. **Partial results are a successful run** (`site:done`, not
  `site:error`) — every page that finished before the ceiling is real data.
- Per-page timeout: 45s, enforced as a real `Promise.race` (not just an
  `AbortSignal`) in `app/api/audit/bulk/route.ts`'s `runOnePage`, because
  `runAudit`'s call-1 has no abort wiring (a pre-existing, documented
  limitation in `pageAudit.ts`'s own comment) — a stuck call-1 can't be
  cancelled, but the queue can race past it so one bad page doesn't stall
  every page behind it.
- `computeSiteRollup`: avg score per lens across scored pages, worst 5 pages
  by mean-lens score, AI-Overview blockers recurring on 2+ pages (≤5) — a
  one-page issue isn't "common".

### 5. Data contract extension + bulk route + UI

`lib/audit/types.ts` gained a new, clearly-delimited "Bulk site-crawl
(additive)" section: `SiteAuditStreamEvent` wraps the *exact same*
`AuditStreamEvent` per page inside `site:page-event` — nothing above that
section changed. Documented as DATA-CONTRACT.md §7 (additive v1.1).

`app/api/audit/bulk/route.ts`: rate limit → concurrency slot → validate →
`createSseResponse` streaming `site:discovery-start` → `site:discovery-done`
→ interleaved per-page events (≤3 concurrent, `runConcurrentQueue`) →
`site:rollup` → `site:done`/`site:error`.

UI: `AuditUrlForm.tsx` gained a "Single page / Whole site" toggle (routes to
`/audit?url=` or `/audit/site?url=`). `app/audit/site/page.tsx` mirrors
`app/audit/page.tsx`. `useSiteAuditStream.ts` accumulates `site:*` events —
critically, it feeds each page's unwrapped `event` through the **same**
`auditStreamReducer` `useAuditStream.ts` already uses, so a page's drill-in
state is byte-identical to what a direct `/api/audit` run would produce.
`SiteAuditReportView.tsx`: discovery status → page list (status + running
score as it streams in) → site rollup (avg lens tiles reusing `ScoreTile`,
worst pages, common findings) → click any finished page to drill into its
full report via the WS3 `AuditReportView`. Failed rows and drilled-in error
views route “Retry page” through the single-page `/api/audit` flow, avoiding
the cost of rerunning the whole site.

## Decisions taken

- **WS4-D1**: Did not refactor `fetchArticle.ts` to share its redirect loop
  with `safeFetch.ts`. Both need the SSRF-critical pin/validate path (now
  shared via `assertSafeUrl`/`validateRedirectHop`), but their surrounding
  concerns differ enough (HTML-only content-type enforcement + typed
  `ImportError` contract vs. content-type-agnostic best-effort text) that
  forcing one shared redirect-loop abstraction would have meant either
  weakening `fetchArticle.ts`'s existing tested behavior or over-generalizing
  a two-caller function. The security-critical part is shared; the loop
  shape is duplicated (~40 lines) once, deliberately.
- **WS4-D2**: `runOnePage`'s per-page timeout is a `Promise.race`, not just
  an `AbortController`. Threading the abort signal through was necessary but
  not sufficient — `packages/scoring`'s `runAudit` (call 1) takes no
  abortSignal (pre-existing, frozen-engine limitation the single-page route
  already documents). Racing the timer past a potentially-hung call-1 is
  what actually keeps the bulk queue moving; the stuck call is abandoned
  (its late events are dropped by the `finished` guard in `runOnePage`), not
  truly cancelled. Flagging in case un-freezing that engine's abort wiring
  becomes worth it — the queue's robustness under a real stuck call-1 would
  improve from "abandon and move on" to "actually cancel".
- **WS4-D3**: `undici` pinned to `^7.18.2`, not the latest major (`8.x`).
  Verified locally: `undici@8.7.0`'s `Agent.dispatch` throws
  `InvalidArgumentError: invalid onRequestStart method` when used as Node's
  global-`fetch` `dispatcher` option, because Node 25 bundles `undici@7.18.2`
  internally and the two majors' `Dispatcher`/handler interface changed
  incompatibly. `7.18.2` works cleanly (see Evidence). This is a real
  cross-version trap worth a coordinator note if any other workstream ever
  reaches for `undici` directly.
- **WS4-D4**: Rewrote `app/api/audit/route.ts` to call `runPageAudit`/
  `createSseResponse` instead of its own inlined pipeline+SSE code — a
  cross-boundary touch on WS2-owned turf. Necessary: "reuse the existing
  single-URL pipeline verbatim per page" (the task brief) is only true if
  there is one pipeline to reuse. All of the single-page route's existing
  tests (`test/api/audit.test.ts`) pass unmodified against the refactored
  route — same behavior, same event sequence, verified byte-for-byte via the
  existing assertions.
- **WS4-D5 (superseded 2026-07-19)**: Per-page retries originally reran the
  whole site. Failed rows and drilled-in errors now link to the existing
  single-page audit route for that URL, so recovery spends only one page's
  audit cost and saves the result as an ordinary individual audit.

## Deviations from spec

- **Branch name**: the task said `ws4-crawl-bulk`; the Conductor workspace
  had already checked out `ws4-bulk-audit-crawl` before this session started
  (visible in `git branch -a` at session start). Per the "don't rename the
  branch unless explicitly told" instruction and since renaming wasn't
  clearly what was being asked (likely just template text), work stayed on
  the existing branch rather than renaming it. Flagging for the coordinator;
  trivial to rename before merge if it matters.
- Everything else matches the five numbered requirements in the task brief
  (discovery with sitemap-first/crawl-fallback/robots/cap; bounded-
  concurrency bulk run reusing the pipeline verbatim; additive DATA-CONTRACT
  extension; mode-toggle UI with drill-in; abuse/cost controls with clean
  partial-results; SSRF pinned-dispatcher fix + regression test).

## Requests across the boundary

- `app/api/audit/route.ts` (WS2 ownership) was refactored — see WS4-D4.
  Behaviorally identical (all existing tests pass unmodified), but flagging
  the file-boundary cross per the pattern WS1/WS2's reports used.
- `lib/audit/stream.ts` gained `createSseResponse`/`formatSiteAuditEvent`/
  `parseSiteAuditFrame`. `formatAuditEvent`/`parseAuditFrame`/
  `HEARTBEAT_FRAME` are untouched.
- `lib/audit/types.ts` gained the additive "Bulk site-crawl" section.
  Nothing above it changed — see DATA-CONTRACT.md §7 for the exact contract
  proposal, already applied in the same commit per this repo's convention
  ("when approved, the source-of-truth types and the doc are updated
  together in one commit" — there being no separate coordinator-approval
  step available in this session, the edit and the doc went in together and
  are flagged here for review).
- `docs/ARCHITECTURE.md`'s "Known deferred items" still lists "Site-wide
  crawling (v1 audits exactly one URL's content)" — now shipped. Left
  ARCHITECTURE.md itself untouched since "coordinator owns structure" per
  its own header; flagging here rather than editing it directly.

## Open questions for the coordinator

1. Confirm the branch-name deviation (WS4-D1 above) is fine as-is.
2. `undici@^7.28.0` is a new root dependency — confirm no objection given
   it's required for the DNS-rebinding fix (WS4-D3 has the version-trap
   detail if this ever needs revisiting).
3. Whether `ARCHITECTURE.md`'s "Known deferred items" line should be updated
   now that site-wide crawling exists — left for the coordinator per its
   ownership note above.

## Evidence

**Quality gates** (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`):

```
$ eslint
$ tsc --noEmit
$ vitest run
 Test Files  25 passed (25)
      Tests  210 passed (210)
$ next build
✓ Compiled successfully in 2.1s
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/audit
├ ƒ /api/audit/bulk
├ ƒ /audit
├ ƒ /audit/site
├ ○ /dev/mock-report
└ ○ /robots.txt
```

**E2E** (`pnpm e2e`, 14/14 — 13 pre-existing + 1 new):

```
✓ landing page renders hero and a focusable URL form
✓ invalid URL shows an inline error and stays on the landing page
✓ valid URL routes to /audit and shows the audited URL
✓ landing page has no critical or serious accessibility violations
✓ pastes a URL and gets a rendered report from a real audit
✓ renders the complete report from mock data alone
✓ keyboard navigation moves through the findings list
✓ is gated out of production (NODE_ENV !== development)
✓ no horizontal overflow at 320px / 768px / 1024px / 1440px
✓ axe: no critical or serious violations
✓ audits a whole site: discovers a 3-page sitemap, streams per-page
  results, rolls up, and drills into a page
14 passed (8.9s)
```

The new spec (`test/e2e/site-audit.spec.ts`) spins up a local fixture HTTP
server (sitemap.xml + 3 real pages), reached via `AUDIT_TEST_ALLOW_LOOPBACK=1`
(playwright.config.ts), and drives the full browser journey: landing form →
"Whole site" toggle → `/audit/site?url=` → real `POST /api/audit/bulk` →
real SSRF-guarded discovery + fetch + Readability extraction of all 3 pages
→ mock LLM calls (`AUDIT_TEST_MOCK=1`) → live-streamed page list + site
rollup → drill-in to one page's full report (asserts all four lens score
tiles and the rewrite panel render, proving `AuditReportView` reuse) → back
to the overview. Only the two LLM calls per page are mocked.

**undici version trap** (WS4-D3), reproduced directly against Node's global
fetch:

```
$ node --version
v25.4.0
$ node -e "console.log(process.versions.undici)"
7.18.2

# undici@8.7.0 (latest major) — BROKEN as a fetch() dispatcher:
$ node -e "
const { Agent } = require('undici'); // 8.7.0
const agent = new Agent({ connect: { lookup: (h,o,cb)=>cb(null,[{address:'127.0.0.1',family:4}]) } });
fetch('http://x/', { dispatcher: agent }).catch(e => console.log(e.cause));
"
InvalidArgumentError: invalid onRequestStart method
    at assertRequestHandler (.../undici@8.7.0/.../core/util.js:568:11)

# undici@^7.28.0 (pinned) — works correctly, and the pin is airtight even
# against a hostname that would NEVER resolve via real DNS:
$ node -e "
const { Agent } = require('undici'); // 7.28.0 (satisfies ^7.18.2)
const http = require('http');
const server = http.createServer((req,res)=>res.end('hello from pinned fetch'));
server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const agent = new Agent({ connect: { lookup: (h,o,cb)=>cb(null,[{address:'127.0.0.1',family:4}]) } });
  const res = await fetch('http://totally-fake-hostname.invalid:'+port+'/', { dispatcher: agent });
  console.log(res.status, await res.text());
});
"
200 hello from pinned fetch
```

**Rebinding regression test** (`lib/import/__tests__/ssrfGuard.test.ts`,
"pinned dispatcher (DNS-rebinding TOCTOU)"): captures the `undici.Agent`
constructor call `assertSafeUrl` makes, then invokes its `connect.lookup`
override with a completely different, attacker-controlled hostname —
proving the pinned lookup ignores it and always returns the originally
validated address. 3 tests (resolved-hostname case, IP-literal case,
per-redirect-hop re-pinning). `lib/import/__tests__/fetchArticle.test.ts`
additionally asserts every `fetch()` call carries a `dispatcher`.

**Real dev-server run against a real bulk site** (`AUDIT_TEST_MOCK=1
AUDIT_TEST_ALLOW_LOOPBACK=1`, a 4-page local fixture site — root + 3-page
sitemap):

```
$ curl -sN -X POST http://localhost:3211/api/audit/bulk \
    -H "content-type: application/json" -d '{"url":"http://127.0.0.1:3212/"}'

data: {"type":"site:discovery-start","rootUrl":"http://127.0.0.1:3212/"}
data: {"type":"site:discovery-done","rootUrl":"...","method":"sitemap","pages":[...4 pages...],"truncated":false}
data: {"type":"site:page-start", ...} / {"type":"site:page-event", ...} / {"type":"site:page-done", ...}   (×4, interleaved, ≤3 concurrent)
data: {"type":"site:rollup","rollup":{"pagesAudited":4,"pagesFailed":0,"avgScores":{"aeo":45,"geo":31,"citability":38,"aiOverview":55},"worstPages":[...],"commonFindings":[{"issue":"Fluff opener buries the answer","count":4}]},"stoppedEarly":null}
data: {"type":"site:done"}
```

**UI, driven with a real browser (Playwright, headed against the dev
server)**: confirmed the mode toggle, the "Pages (4)" list with per-page
live status + score, the site rollup (4 lens tiles, worst pages, common
findings), and — critically — clicking a finished page renders the full,
unmodified WS3 `AuditReportView` (all four score tiles, E-E-A-T strip,
findings drawer, rewrite before/after panel) exactly as a direct
`/api/audit` run would. Also independently confirmed the abuse controls
live: a second concurrent request from the browser correctly hit the
per-IP rate limit and rendered the `site:error` banner with a working "Run
again" button.

**SSRF checklist** (crawling multiplies fetch surface — every item
re-verified for the bulk path, not just re-asserted from WS2):

- DNS-rebinding TOCTOU — closed this phase (pinned dispatcher, see above).
  Previously "validated per-hop but not pinned"; now pinned per-hop.
- private/loopback/link-local/metadata IPv4 + IPv6 — unchanged, still
  covered (`ssrfGuard.test.ts`), now also exercised by every discovery fetch
  (robots.txt, sitemap.xml + index children, every crawled page) via the
  same `assertSafeUrl`.
- redirect re-validation — unchanged (`validateRedirectHop` on every hop),
  now also used by `safeFetch.ts`'s redirect loop.
- credentials-in-URL / non-http(s) scheme rejection — unchanged, shared.
- test-only loopback bypass (`AUDIT_TEST_ALLOW_LOOPBACK`) — scoped to
  loopback literals only, verified it does NOT widen to other private
  ranges (`ssrfGuard.test.ts` "does not widen the bypass to non-loopback
  private ranges"), never set outside test config.

## Coordinator review

(appended by coordinator: verdict merge / changes-requested + notes)
