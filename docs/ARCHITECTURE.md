# Architecture — SEO AI Audit v1 (anonymous)

Status: **target architecture** for the v1 rebuild. Owner: coordinator session
(Fable). Last updated: 2026-07-17.

## Product in one line

An open, anonymous, low-friction tool: paste a URL on the landing page, get a
streamed AI-search audit (0–100 lens scores + evidence-backed findings) back.
No account, no signup, no stored data.

## Hard constraints (do not violate in any workstream)

1. **No auth.** No better-auth, no sessions, no cookies that identify users.
   Auth is Phase 5, a separate future phase (restore point:
   `backup/pre-rewrite`).
2. **No database.** v1 is stateless. No drizzle, no postgres, no Supabase
   client. Nothing is persisted server-side; the client holds the report.
3. **Server-side LLM key.** Audits run on a key the *operator* configures in
   the server env (Vercel) — never a per-user/BYOK key (that's gone with the
   auth teardown). The operator may point that key at Anthropic direct, an
   Anthropic-compatible proxy, or any OpenAI-compatible endpoint
   (OpenRouter, zenmuz.ai, Ollama, ...) — see "AI provider configuration"
   below. `AUDIT_TEST_MOCK=1` selects the deterministic mock model (no key,
   no spend) for tests and CI.
4. **User-supplied URLs are hostile input.** Every fetch goes through
   `lib/import/ssrfGuard.ts` (private/loopback/metadata IP blocking) plus
   timeout, size, and redirect caps. See `docs/phases/ws2-audit-api-spec.md`.
5. **The shared contract is law.** `docs/DATA-CONTRACT.md` defines the shapes
   WS2 produces and WS3 consumes. Contract changes go through the coordinator
   (propose in your report doc; do not unilaterally edit shared types).

## System shape

```
Browser                          Vercel (Next.js 16, App Router)
───────                          ─────────────────────────────────
/            landing page  ───►  static page (WS1)
  paste URL, submit
        │ router.push
        ▼
/audit?url=…  results page ───►  page shell (WS1) + results UI (WS3)
        │ POST {url}
        ▼
/api/audit   ──────────────────► Node runtime route (WS2)
                                   ├─ zod-validate url
                                   ├─ per-IP rate limit
                                   ├─ ssrfGuard → fetch → extract (lib/import)
                                   ├─ @aeo/scoring: 11 DET signals (pure TS)
                                   ├─ LLM rubric (server key): 7 RUB signals,
                                   │    findings, rewrites
                                   └─ SSE stream of AuditStreamEvent frames
```

Data flows one way: URL in → SSE events out → client-side state → rendered
report. Refresh = re-run. Share = the URL itself (`/audit?url=…`).

## Repository map (what exists, who owns what)

| Path | Contents | Status |
|---|---|---|
| `packages/scoring` | Audit engine: 18 signals (11 DET pure-TS + 7 LLM RUB), 4 weighted lenses, hard caps, versioned rubric, cache keys. 100+ tests, 8 fixtures. | **Frozen. Reuse, don't refactor.** |
| `lib/import` | `fetchArticle` (URL fetch), `extract` (readability), `ssrfGuard` (+tests) | WS2 adapts/extends |
| `lib/audit` | SSE framing (`stream.ts`), provider factory (`provider.ts`), rate limit, error mapping, `types.ts` (contract home), score derivation, mock model | WS2 adapts; `types.ts` changes only per contract |
| `lib/export` | markdown/HTML/roadmap exporters | Phase 4; leave alone |
| `app/components/ui`, `app/components/workbench` | ScoreTile, ScoreRail, SeverityChip, SignalBreakdown, EeatStrip, FindingsDrawer, RoadmapPanel, DiffHunk… | WS3 reuses/adapts |
| `app/` pages | placeholder landing only | WS1 owns |
| `docs/` | this documentation set | all sessions append; coordinator owns structure |

## Design system

Light-first Swiss/editorial, one accent, tokens in `app/globals.css`
(`--surface-*`, `--text-*`, `--accent-ink`, score scale red→amber→green always
paired with a text/glyph cue). Geist Sans + Geist Mono. Use the existing
`Button`/`Card` primitives. Do not introduce a second design language or a
dark theme in v1.

## Quality gates (every workstream, before reporting done)

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

plus the workstream-specific verification in its spec (e2e, deploy check,
axe). Report actual command output in your phase report, not "passed".

## AI provider configuration

The two LLM calls per audit (RUB rubric scoring, then rewrite generation) run
through `lib/audit/provider.ts`'s `resolveProvider()`, env-first:

1. **`ANTHROPIC_API_KEY` alone** (no other `AI_*` var) — the default,
   backward-compatible path. Real Anthropic API, built-in per-tier models
   (Haiku for scoring, Sonnet for rewrites). Existing deployments configured
   this way are unaffected by anything below.
2. **`AI_PROVIDER=openai-compatible`** + `AI_API_KEY` + `AI_BASE_URL` +
   `AI_MODEL` — one code path (the AI SDK's OpenAI client, hitting the
   classic `/chat/completions` route, not the newer Responses API) covers
   OpenRouter, zenmuz.ai, Ollama's OpenAI-compat mode, vLLM, LiteLLM, and
   most other OpenAI-compatible proxies. `AI_MODEL` runs both LLM calls —
   custom providers get one model, not the cheap/strong split.
3. **`AI_PROVIDER=anthropic`** + `AI_API_KEY` (falls back to
   `ANTHROPIC_API_KEY` if unset) + optional `AI_BASE_URL` (an
   Anthropic-compatible proxy) + optional `AI_MODEL` (defaults to the
   built-in per-tier ids).

An unrecognized `AI_PROVIDER` value, or nothing configured at all, falls back
toward the safest known-good state (never crashes the process to resolve
credentials). See `.env.example` for the full var list and `lib/audit/provider.ts`
for the resolution order. Keys are never logged — provider/LLM failures are
mapped through `lib/audit/errors.ts`'s `mapLlmError`, which reads only a
numeric status code and a retry-after header off the SDK error, never the raw
error object (which can carry the Authorization header).

No provider configured → the route still validates the URL, fetches, and
extracts the page, and streams `meta` + `signals` (those don't need an LLM);
only the `scores`/`rewrites` phase fails, with a generic, key-safe `server`
error event. Same behavior regardless of *why* no provider is configured.

DATA-CONTRACT is unaffected — provider choice is a server-side implementation
detail; the SSE wire shape (`docs/DATA-CONTRACT.md`) doesn't change.

## Deployment

Vercel project `seo-ai-audit` (team `orbix2`, project
`prj_mRVyPhFrSAqvjgN4xqnyHZYg8XTJ`), framework preset **nextjs** — do not
unset it; a null framework previously produced broken deployments that 404'd.
Deploys must be verified by requesting the production URL and checking real
HTML, not by deployment status alone (a READY deployment has served 404s
before — see docs/DECISIONS.md D-007).

## Known deferred items

- Auth + persistence (Phase 5) — restore from `backup/pre-rewrite`.
- Site-wide crawling (v1 audits exactly one URL's content).
- Headless-browser rendering for JS-heavy pages (flag "may be incomplete"
  instead, as the content extractor does today).
- Per-user BYOK keys (multi-provider *server*-key config exists — see "AI
  provider configuration"), cost guardrails beyond a per-audit cap.
