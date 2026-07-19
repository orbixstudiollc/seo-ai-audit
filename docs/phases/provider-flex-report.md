# Flexible AI provider — phase report

Branch: `provider-flex`, off `main` @ `ac1b7fe` (the WS1/WS2/WS3 integration).

## What shipped

- **`lib/audit/provider.ts`** — replaced the `ANTHROPIC_API_KEY`-only factory
  with `resolveProvider(env)`, an env-driven resolver:
  1. `AI_PROVIDER=openai-compatible` + `AI_API_KEY` + `AI_BASE_URL` +
     `AI_MODEL` (all four required) — one code path via the AI SDK's
     OpenAI client, `.chat(modelId)` (classic `/chat/completions`, not the
     newer `/responses` API). Covers OpenRouter, zenmuz.ai, Ollama's
     OpenAI-compat mode, vLLM, LiteLLM, and most other OpenAI-compatible
     proxies. `AI_MODEL` runs both LLM calls — one model per custom
     provider, not a cheap/strong split.
  2. `AI_PROVIDER=anthropic` + `AI_API_KEY` (falls back to
     `ANTHROPIC_API_KEY`) + optional `AI_BASE_URL` (an Anthropic-compatible
     proxy, `/v1` inserted the same way the pre-pivot code worked around)
     + optional `AI_MODEL` (defaults to the built-in per-tier ids).
  3. No `AI_PROVIDER` (or an unrecognized value) — the exact legacy path:
     `ANTHROPIC_API_KEY` alone, real Anthropic API, built-in per-tier
     models (`claude-haiku-4-5-20251001` / `claude-sonnet-5`). **No
     breaking change** — the live production deployment (only
     `ANTHROPIC_API_KEY` set, once added) needs zero config changes.
  `buildServerModel(tier)` throws a single actionable error when
  `resolveProvider` returns `null` (nothing configured); the
  `AUDIT_TEST_MOCK=1` escape hatch is checked first and unaffected.
- **Salvaged from `backup/pre-rewrite:lib/audit/provider.ts`**: the
  `.chat(modelId)` fix for OpenAI-compatible proxies (avoids the newer
  Responses API most third-party endpoints don't implement) and the
  `createAnthropic({baseURL})` `/v1`-insertion fix for Anthropic-compatible
  proxies (the SDK doesn't insert it itself) — both empirically found by
  the pre-pivot BYOK code against live third-party endpoints, both still
  correct, both reused verbatim rather than rediscovered.
- **`lib/audit/errors.ts`** — untouched. `mapLlmError` already reads only a
  numeric status code and a `retry-after` header off `APICallError`
  instances, provider-agnostically; it needed no changes to stay
  key-safe across the new openai-compatible path.
- **`.env.example`** — documents both configuration paths:
  `ANTHROPIC_API_KEY` alone (default), or `AI_PROVIDER` +
  `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL` for everything else.
- **`docs/ARCHITECTURE.md`** — hard constraint #3 reworded (server-side key,
  operator-chosen provider, still no per-user BYOK); new "AI provider
  configuration" section; "Known deferred items" corrected (multi-provider
  server-key config now exists; per-user BYOK is still deferred).
  `docs/DATA-CONTRACT.md` is untouched — provider choice is a server-side
  implementation detail, the SSE wire shape doesn't change.
- **Tests** — `lib/audit/provider.test.ts` rewritten: 9 `resolveProvider`
  precedence/fallback cases (including the "unaffected by this change"
  legacy-only case and the unrecognized-`AI_PROVIDER` fallback), the
  `AUDIT_TEST_MOCK` escape hatch, the no-provider-configured error, the
  anthropic path (legacy + `AI_MODEL` override), and a **mocked HTTP round
  trip** for the openai-compatible path — a stubbed `fetch` captures the
  actual request and asserts the URL is
  `{AI_BASE_URL}/chat/completions` (not `/responses`), the `Authorization`
  header carries `AI_API_KEY`, and the request body's `model` field is
  `AI_MODEL`. 16 tests, all passing.

## Also applied (per the review team's gap docs)

From `docs/reviews/ws1-gaps.md` (branch `ws1-scaffold-gap-review`), both
flagged as trivial fixes owned by WS1's row (deploy config / the form
component):

- **#1 — visible focus state on the URL input.** `AuditUrlForm.tsx`'s input
  had `focus:outline-none` with no replacement (violated the spec's
  "visible focus states" constraint; invisible to axe defaults and to the
  e2e's `toBeFocused()`, which only checks programmatic focus). Added
  `focus-within:border-accent-ink focus-within:ring-2
  focus-within:ring-accent-ink/30` to the input's wrapper (existing design
  tokens, no new colors). Extended
  `test/e2e/landing.spec.ts`'s first test to assert the wrapper's computed
  `border-color` actually changes on focus, not just that the input
  receives it.
- **#5 — no security headers.** `next.config.ts` had none. Added a
  `headers()` block: CSP, HSTS, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` (camera/mic/geolocation denied). The CSP's
  `script-src`/`style-src` need `'unsafe-inline'` — Next's App Router
  streams RSC hydration data via inline `<script>` tags, and several
  components use inline `style={{}}` for CSS custom properties; a
  nonce-based CSP would need `middleware.ts` to mint a per-request nonce,
  which this deliberately middleware-free, stateless app doesn't otherwise
  need (documented as a `ponytail:` comment with the upgrade path).
  `'unsafe-eval'` is added to `script-src` **only when `NODE_ENV !==
  "production"`** — React's dev-mode debugging needs it, production never
  calls it; verified the real production build's CSP header excludes it
  (see Evidence).

**Explicitly not touched**: `docs/reviews/ws2-gaps.md`'s SSRF DNS-rebinding
TOCTOU (#1, high severity) — per the user's instruction, a separate crawl
workstream owns that hardening.

## Never-log-keys verification

- `mapLlmError` (`lib/audit/errors.ts`) reads only `err.statusCode` and the
  `retry-after` response header off `APICallError` instances — both
  provider-agnostic and key-free — and returns an authored message. It
  never returns, logs, or nests the raw error object. This logic is
  unchanged by this phase and applies identically to the Anthropic and
  openai-compatible paths (both go through the same AI SDK error type).
- `route.ts`'s `logFailure` logs only `{ host, kind }` — never the error
  message, never the URL, never provider config.
- Grepped the diff for anything that could echo a key: no `console.log`/
  `console.error` call in `provider.ts` touches `apiKey`, `AI_API_KEY`, or
  `ANTHROPIC_API_KEY`.

## Evidence

### Gates

```
$ pnpm lint && pnpm typecheck && pnpm test && pnpm build
$ eslint
$ tsc --noEmit
 Test Files  18 passed (18)
      Tests  169 passed (169)
✓ Compiled successfully
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/audit
├ ƒ /audit
├ ○ /dev/mock-report
└ ○ /robots.txt

$ pnpm e2e
13 passed (8.5s)
```

### Production CSP verification (local prod build, real server)

```
$ curl -sSI http://localhost:3333/ | grep -i content-security-policy
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```
`'unsafe-eval'` correctly absent — confirms the `NODE_ENV === "production"`
gate works, not just in theory. Page still renders (`<h1>Paste a URL...`),
`/dev/mock-report` still 404s.

### Provider tests

```
$ pnpm exec vitest run lib/audit/provider.test.ts
 Test Files  1 passed (1)
      Tests  16 passed (16)
```

### Live production deploy + degradation check

Deployed via `npx vercel deploy --prod` (project already linked from the
prior integration session):

```
Production      https://seo-ai-audit-jrthn4t8a-orbix2.vercel.app
Aliased         https://seo-ai-audit-pied.vercel.app
```

Same sandbox-local DNS/routing quirk on the alias domain documented in
D-007/the prior integration report — bypassed the same way
(`--resolve seo-ai-audit-pied.vercel.app:443:76.76.21.21`):

```
$ curl -sS --resolve ... -o /dev/null -w "HTTP %{http_code}\n" https://seo-ai-audit-pied.vercel.app/
HTTP 200

$ curl -sSI --resolve ... https://seo-ai-audit-pied.vercel.app/ | grep -i "content-security-policy\|strict-transport\|x-content-type\|x-frame\|referrer-policy\|permissions-policy"
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
permissions-policy: camera=(), microphone=(), geolocation=()
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=31536000; includeSubDomains; preload
x-content-type-options: nosniff
x-frame-options: DENY
```
`'unsafe-eval'` correctly absent in the live production `script-src` — the
`NODE_ENV` gate works in the real Vercel build, not just locally.

**Real audit against the live production API** — no `AI_PROVIDER`/`AI_API_KEY`/
`ANTHROPIC_API_KEY` are set in Vercel yet (same gap the integration report
flagged; unchanged by this phase):

```
$ curl -sN --resolve ... -X POST https://seo-ai-audit-pied.vercel.app/api/audit \
    -H "content-type: application/json" -d '{"url":"https://example.com/"}'

data: {"type":"meta","page":{"title":"Example Domain","wordCount":16,...}}
data: {"type":"signals","signals":{...all 11 DET signals...}}
data: {"type":"error","kind":"server","message":"The audit failed due to an unexpected error. Try again in a moment."}
```

Identical degradation behavior to before this phase, now routed through
`resolveProvider()` instead of the old direct `ANTHROPIC_API_KEY` check:
`meta`/`signals` stream successfully (real fetch, real extraction, real DET
signals), only the LLM-dependent phase fails, and the failure message is
generic — no env var names, no "AI_PROVIDER"/"ANTHROPIC_API_KEY" text, no
stack trace reach the client. The detailed
"No AI provider is configured..." message stays server-side only (visible
in Vercel's function logs, never in the SSE response).

## Open questions for the user

1. To actually use a custom provider, set `AI_PROVIDER` +
   `AI_API_KEY`/`AI_BASE_URL`/`AI_MODEL` in Vercel production — none of
   these are set yet (only the still-missing `ANTHROPIC_API_KEY` from the
   prior integration report applies). No action needed if Anthropic direct
   is the intended provider — just add `ANTHROPIC_API_KEY` as already
   flagged.
2. `docs/reviews/ws2-gaps.md`'s SSRF TOCTOU (#1) and `quotables`
   hardcoded-`[]` (#5) are unaddressed here by design (out of this
   session's scope per your instruction) — still open for the crawl
   workstream / a coordinator ruling respectively.
