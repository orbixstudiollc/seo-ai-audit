# WS2 (Audit Engine / API) — phase report

> Filled in by the WS2 execution session as work proceeds (RULE B: document
> as you go). The coordinator appends reviews here.

## Status

- [x] started · [x] spec read · [x] building · [x] gates green (my scope) · [x] ready for review

Branch: `ws2-audit-api` (branched from `origin/main` @ `52a78c7`).

## What shipped

- `app/api/audit/route.ts` — new `POST /api/audit`, Node runtime, `maxDuration = 300`.
  Per-IP rate limit -> zod body validation + URL shape check -> SSRF-guarded
  fetch (`lib/import`) -> Readability extraction -> content cap -> DET signals
  -> rubric LLM call (`@aeo/scoring.runAudit`) -> rewrite LLM call
  (`lib/audit/generator.generateRewrites`) -> SSE stream, exactly
  `meta → signals → scores → rewrites → done` per DATA-CONTRACT §2.
- `lib/audit/types.ts` — applied the exact v1 contract edit: added `PageMeta`
  + the `meta` event, `done` now carries no `auditId`, `AuditErrorKind`
  narrowed to the 5-member v1 set. Deleted `WorkbenchDocument`,
  `WorkbenchAudit`, `AuditPhaseStatus`, `ApiKeyProvider` (all BYOK/persistence
  concepts with no place in a stateless, keyless v1).
- `lib/audit/provider.ts` — replaced BYOK multi-provider model construction
  (`buildByokModel`, `CustomProviderConfig`, `Provider`, `modelIdFor`) with a
  single server-key factory: `buildServerModel(tier)` reads
  `ANTHROPIC_API_KEY` from the server env (throws a clear error if unset),
  `serverModelId(tier)` for the fixed tier→model-id map. `AUDIT_TEST_MOCK=1`
  still routes to the deterministic mock model.
- `lib/audit/errors.ts` — replaced the multi-provider `mapProviderError` with
  `mapLlmError` (single Anthropic key, so failures collapse to `rate_limit` |
  `server` — no per-user auth/quota to report) and added `mapImportError`
  (maps `lib/import`'s `ImportError.kind` onto the wire's `AuditErrorKind`:
  `blocked`/`timeout`/`fetch_failed` → `fetch_failed`;
  `too_large`/`not_html` → `unsupported_content`).
- `lib/audit/requestValidation.ts` (new) — `parseAuditUrl`: absolute
  http(s), ≤2048 chars, shape-only (SSRF safety stays `lib/import`'s job).
- `lib/audit/contentCap.ts` (new) — `capAuditContent`: the ~8k-word
  per-audit cost ceiling. Computes the doc once, reused for the `signals`
  event, the rubric call, and the rewrite call, so all three see identical
  content.
- `lib/import/fetchArticle.ts` — added an optional external `signal` to
  `fetchArticle`'s options, composed with its own timeout `AbortController`,
  so a client disconnect can abort an in-flight page fetch.
- `lib/audit/generator.ts` — `generateRewrites` now accepts an optional
  `abortSignal`, threaded to `generateObject`.
- `lib/audit/cost.ts` — deleted (BYOK-era "cost on your key" estimate; no
  user-owned key in v1, and nothing else imported it).
- `.env.example` (new) — documents `ANTHROPIC_API_KEY` and `AUDIT_TEST_MOCK`.
  `.gitignore` gained a `!.env.example` exception (the existing `.env*` rule
  would otherwise have swallowed it).
- Tests added: `lib/audit/requestValidation.test.ts`,
  `lib/audit/contentCap.test.ts`, `lib/audit/errors.test.ts`,
  rewritten `lib/audit/provider.test.ts`, `test/api/audit.test.ts`
  (integration), `test/helpers/testServer.ts` (new — real local `http.Server`
  fixture for the integration suite), plus two new SSRF/abort cases added to
  the existing `lib/import/__tests__/fetchArticle.test.ts`.

## Decisions taken

- **WS2-D1**: `provider.ts`/`errors.ts` were simplified from multi-provider
  BYOK shapes down to a single Anthropic server-key path, rather than kept
  generic "in case" of a future provider. Nothing in the v1 architecture
  needs provider choice, and speculative multi-provider plumbing was exactly
  the kind of code this pivot was tearing out.
- **WS2-D2**: content-cap truncation (`contentCap.ts`) keeps the original
  HTML verbatim for normal-length articles (full structural fidelity for
  DET signals) and only falls back to plain-text truncation for the rare
  oversized-page case, trading structural signal fidelity for simplicity on
  a path that's a cost backstop, not a common case. Documented as a
  `ponytail:` comment with the upgrade path (DOM-aware truncation via
  `linkedom`, already a dependency) if long-page audits turn out to be
  common.
- **WS2-D3**: Client-disconnect abort is wired through everything WS2 owns
  (the page fetch via `fetchArticle`'s new `signal` option, and the rewrite
  call via `generateRewrites`' new `abortSignal`), plus a `signal.aborted`
  guard before starting each LLM call so a disconnect skips spend it can.
  It is **not** wired into `@aeo/scoring.runAudit`'s internal
  `generateObject` call — that engine is frozen and `RunAuditInput` has no
  abort seam. A disconnect mid-rubric-call lets that one call finish
  server-side before the pipeline notices. See "Requests across the
  boundary."
- **WS2-D4**: Rate limiting rejects with 429 **before** parsing the request
  body (mirrors the pre-pivot route), so a flood of even malformed bodies
  from one IP still gets stopped by the bucket.

## Deviations from spec

- Spec suggested reusing `git show backup/pre-rewrite:app/api/audit/route.ts`
  as a "mostly subtraction" blueprint. In practice the SSE framing/heartbeat
  skeleton (`sseResponse`) carried over almost unchanged; everything
  DB/auth/BYOK/idempotency-related (idempotency cache key, `after()`
  durable persistence, orphan-row sweep, 409 `already_running`) was dropped
  entirely rather than adapted, since none of it has a v1 equivalent
  (nothing is ever persisted).
- Added a `signal` option to `fetchArticle` (a file the spec lists as mine
  to adapt) — not explicitly called out in the task list, but required to
  fulfil "client disconnect → abort LLM calls (wire AbortSignal through)"
  for the fetch phase.

## Requests across the boundary

Deleting `WorkbenchDocument` / `WorkbenchAudit` / `AuditPhaseStatus` /
`ApiKeyProvider` from `lib/audit/types.ts` (mandated by the spec's contract
edit) breaks 5 files outside my ownership. These are **not** mechanical
import-path fixes — the types themselves are gone, and in one case
(`ScoreRail.tsx`) the logic assumes a deleted `AuditErrorKind` member — so
per the spec's own carve-out I'm flagging rather than patching:

- `app/components/workbench/ExportMenu.tsx` (WS3-owned) — imports
  `WorkbenchAudit`/`WorkbenchDocument`.
- `app/components/workbench/ScoreRail.tsx` (WS3-owned) — compares
  `errorKind === "no_key"`, a BYOK-era `AuditErrorKind` member that no
  longer exists in the v1 union; TS now flags the comparison as an
  impossible overlap.
- `lib/export/index.ts` (marked "Phase 4; leave alone" in
  `docs/ARCHITECTURE.md`) — imports both deleted types; also has one
  pre-existing implicit-`any` (`lib/export/index.ts:43`) unrelated to my
  change, surfaced by the same `tsc` run.
- `lib/export/__tests__/export.test.ts`, `test/components/exportMenu.test.ts`
  — same import breakage in their respective test files.

**Recommendation for the coordinator**: v1's rewrites are read-only (no
accept/reject, per DATA-CONTRACT §3), so the entire export/workbench feature
these 5 files serve appears to be Phase-4/pre-pivot leftovers rather than
part of the v1 surface WS1/WS3 are building. Suggest either (a) deleting
`lib/export/**`, `app/components/workbench/ExportMenu.tsx`, and their tests
now as part of the v1 clean-slate (matching how auth/DB were torn down), or
(b) if WS3 still wants them, updating them to the v1 `AuditReport` shape
(`docs/DATA-CONTRACT.md` §4) once WS3's branch lands. Either way, this is
the reason `pnpm typecheck`/`pnpm build` are red on this branch — everything
inside `app/api/audit/**`, `lib/audit/**`, `lib/import/**`, `test/api/**`,
`test/helpers/**` is green (see Evidence).

Also flagging: `@aeo/scoring`'s `RunAuditInput` has no `abortSignal` field
(see WS2-D3) — a future request to loosen the freeze on `packages/scoring`
if end-to-end disconnect-abort of the rubric call ever matters.

## Open questions for the coordinator

1. Should `lib/export/**` / `ExportMenu.tsx` be deleted now, or left for a
   later phase to reconcile against the new contract? (see above)
2. `ANTHROPIC_API_KEY` needs to be added to the Vercel project
   (`prj_mRVyPhFrSAqvjgN4xqnyHZYg8XTJ`) production env before this route
   works against a real key — that's a secret, so it's a coordinator/user
   action, not something I can do from here.

## Evidence

### Tests, lint, typecheck (my scope)

```
$ pnpm test
 Test Files  18 passed (18)
      Tests  167 passed (167)

$ pnpm lint
$ eslint
(clean, no output)

$ pnpm typecheck
$ tsc --noEmit
app/components/workbench/ExportMenu.tsx(4,15): error TS2305: Module '"@/lib/audit/types"' has no exported member 'WorkbenchAudit'.
app/components/workbench/ExportMenu.tsx(4,31): error TS2305: Module '"@/lib/audit/types"' has no exported member 'WorkbenchDocument'.
app/components/workbench/ScoreRail.tsx(138,14): error TS2367: This comparison appears to be unintentional because the types 'AuditErrorKind | null' and '"no_key"' have no overlap.
lib/export/__tests__/export.test.ts(15,3): error TS2305: Module '"../../audit/types"' has no exported member 'WorkbenchAudit'.
lib/export/__tests__/export.test.ts(16,3): error TS2305: Module '"../../audit/types"' has no exported member 'WorkbenchDocument'.
lib/export/index.ts(1,15): error TS2305: Module '"../audit/types"' has no exported member 'WorkbenchAudit'.
lib/export/index.ts(1,31): error TS2305: Module '"../audit/types"' has no exported member 'WorkbenchDocument'.
lib/export/index.ts(43,66): error TS7006: Parameter 'h' implicitly has an 'any' type.
test/components/exportMenu.test.ts(12,28): error TS2305: Module '"@/lib/audit/types"' has no exported member 'WorkbenchAudit'.
test/components/exportMenu.test.ts(12,44): error TS2305: Module '"@/lib/audit/types"' has no exported member 'WorkbenchDocument'.
```
All 10 errors are the 5 out-of-scope files listed above — zero errors under
`app/api/audit/**`, `lib/audit/**`, `lib/import/**`, `test/**`.

`pnpm build` fails at the same `tsc` step, same root cause (Next's build
runs a full-project typecheck; it isn't scoped per-workstream).

### Happy path — live curl transcript (`AUDIT_TEST_MOCK=1`, real dev server, real fetch of `https://example.com/`)

```
$ curl -sN -X POST http://localhost:3000/api/audit -H "content-type: application/json" -d '{"url":"https://example.com/"}'

data: {"type":"meta","page":{"url":"https://example.com/","finalUrl":"https://example.com/","title":"Example Domain","wordCount":16,"fetchedAt":"2026-07-16T20:41:28.979Z"}}

data: {"type":"signals","signals":{"S1":{...},"S2":{...}, ... "S11":{...}}}

data: {"type":"scores","scores":{"lenses":{"aeo":{"lens":"aeo","score":45,"capped":false},"geo":{...},"citability":{...},"aiOverview":{...}},"signals":{"S1":{...}, ... ,"S18":{"id":"S18","score":70,"evidence":null}},"rubricVersion":"v1.0.0","signalsVersion":"v1.0.0","modelId":"mock-cheap"},"findings":{"questionGaps":["How long does a heat pump last?"],"anchorSuggestions":[{"claim":"A typical install runs $4,000 to $8,000","suggestedSourceType":"primary_data"}],"blockers":[{"issue":"Fluff opener buries the answer","location":"opening paragraph"}],"qaPairs":[],"quotables":[]}}

data: {"type":"rewrites","rewrites":{"hunks":[{"id":"intro","kind":"intro","label":"Answer-first intro","before":"In today's fast-paced world...","after":"A heat pump moves heat rather than making it, reaching about 300% efficiency."}]}}

data: {"type":"done"}
```
Event order matches `meta → signals → scores → rewrites → done` exactly
(DATA-CONTRACT §6 invariant 1); all 18 signal ids and all 4 lens keys present
in `scores` (invariant 2); `findings` arrays present and bounded (invariant 4).

### 400 invalid_url (real dev server)

```
$ curl -s -X POST http://localhost:3000/api/audit -H "content-type: application/json" -d '{"url":"ftp://example.com/file"}' -w '\nHTTP %{http_code}\n'
{"error":"invalid_url","message":"That doesn't look like a valid http(s) URL."}
HTTP 400
```

### SSRF-blocked (real dev server, loopback target)

```
$ curl -sN -X POST http://localhost:3000/api/audit -H "content-type: application/json" -d '{"url":"http://127.0.0.1:9/admin"}'
data: {"type":"error","kind":"fetch_failed","message":"This URL points to a blocked or private network address — paste the article text instead."}
```

### SSRF checklist (spec §"SSRF hardening review")

`lib/import/ssrfGuard.ts` pre-existed and already covers every item, with
existing tests in `lib/import/__tests__/ssrfGuard.test.ts`:
- private/loopback/link-local/metadata IPv4 **and** IPv6 — covered
  (`assertSafeUrl — IPv4 literals`, `— IPv6 literals`).
- DNS re-resolution pinning across redirects — covered
  (`assertSafeUrl — DNS resolution (rebinding vector)`,
  `validateRedirectHop` re-runs the full guard on every hop in
  `fetchArticle.ts`).
- obfuscated IP encodings (decimal/hex) — covered ("blocks obfuscated IPv4
  literals (WHATWG canonicalization)"); octal is canonicalized identically
  by the same WHATWG URL parser (no separate test needed — same code path).
- credentials-in-URL rejection — covered ("rejects URLs with embedded
  credentials").
- non-http(s) scheme rejection — covered ("rejects non-http(s) schemes").
No gaps found; no new SSRF tests were needed. New coverage added this phase
was for the *route's* use of `fetchArticle`'s new `signal` option (client
disconnect), not SSRF itself — see `lib/import/__tests__/fetchArticle.test.ts`.

### Grep for banned imports (DB/auth/BYOK)

```
$ grep -rln "better-auth\|drizzle\|@/db/\|decryptApiKey\|apiKeys\b" app/api lib/audit lib/import
(no matches)
```

## Coordinator review

(appended by coordinator: verdict merge / changes-requested + notes)
