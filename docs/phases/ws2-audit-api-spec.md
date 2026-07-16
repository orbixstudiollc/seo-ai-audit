# WS2 — Audit Engine / API (spec)

Branch: `ws2-audit-api`. Read first: `docs/ARCHITECTURE.md`,
`docs/DATA-CONTRACT.md` (you are its producer), `docs/COORDINATION.md`.
Your report: `docs/phases/ws2-report.md`.

## Goal

`POST /api/audit { url }` — anonymous, stateless: SSRF-guarded fetch →
content extraction → scoring engine → SSE stream exactly per DATA-CONTRACT
v1.0. Server-side LLM key. No auth, no DB, nothing persisted.

## Context you need

- **The pre-pivot route is your blueprint.** Read
  `git show backup/pre-rewrite:app/api/audit/route.ts` — it already does SSE
  framing, heartbeats, two-phase LLM calls, rate limiting, error mapping.
  Your job is largely *subtraction*: delete auth/session, DB reads/writes,
  BYOK key decryption, documentId indirection; add URL fetch as the content
  source and the `meta` event.
- Engine: `@aeo/scoring` — `computeParsedDocument`, `runAudit`,
  `canonicalize`, `DET_SIGNALS`, versions. See
  `packages/scoring/src/index.ts` and how the old route called it.
- Fetch/extract: `lib/import/fetchArticle.ts`, `extract.ts`,
  `ssrfGuard.ts` (all tested). Rewrites/findings generation:
  `lib/audit/generator.ts`. SSE helpers: `lib/audit/stream.ts`. Rate limit:
  `lib/audit/ratelimit.ts`. Provider: `lib/audit/provider.ts`
  (`buildByokModel(apiKey, …)` — rename/adapt to a server-key factory).
  Mock model: `lib/audit/testModel.ts` behind `AUDIT_TEST_MOCK=1`.

## Tasks

1. **Contract edit** (`lib/audit/types.ts`, `lib/audit/stream.ts` untouched):
   apply exactly the v1 event/error shape from DATA-CONTRACT §2 (add
   `PageMeta` + `meta` event, `done` without auditId, new `AuditErrorKind`
   set). Delete dead types (`WorkbenchDocument`, `WorkbenchAudit`,
   `AuditPhaseStatus`) and fix any fallout in components you don't own by
   *flagging it in your report* — WS3 owns those files (exception: type
   imports may be updated mechanically if WS3's branch hasn't touched the
   file; note each in the report).
2. **Route `app/api/audit/route.ts`** (Node runtime, `maxDuration = 300`):
   - zod-validate body; 400 / 429 JSON pre-stream errors per contract §1.
   - Per-IP rate limit (adapt `checkRateLimit`; suggested: 5/min/IP and
     20/day/IP — constants at top, coordinator can tune).
   - Fetch via `lib/import` (ssrfGuard mandatory): timeout ≤15s, max 3
     redirects (re-validate each hop against the guard), max 2MB body,
     `text/html` only → else `unsupported_content`.
   - Extract title + article content; empty/unusable extraction →
     `unsupported_content`.
   - Emit `meta` → compute DET signals → emit `signals` → run rubric on the
     server key (`ANTHROPIC_API_KEY`; `AUDIT_TEST_MOCK=1` → mock model) →
     emit `scores` (+findings) → generate rewrites → emit `rewrites` → emit
     `done`. Heartbeat every 15s throughout. Client disconnect → abort LLM
     calls (wire `AbortSignal` through, as the old route did).
   - Per-audit input cap: truncate content to ~8k words before the LLM calls
     (cost ceiling; constant at top).
3. **SSRF hardening review** — the guard exists and is tested; verify against
   this checklist and extend where gaps exist (each gap = a test):
   private/loopback/link-local/metadata IPs (v4 **and** v6), DNS
   re-resolution pinning across redirects, obfuscated IP encodings
   (decimal/hex/octal), credentials-in-URL rejection, non-http(s) scheme
   rejection.
4. **Tests**:
   - Unit: URL validation, error mapping, content cap.
   - Integration (`test/api/audit.test.ts`, vitest + mock model + a local
     `http.Server` fixture serving test HTML): happy path streams the full
     event sequence per contract §6 invariants; SSRF-blocked URL →
     `fetch_failed`; non-HTML → `unsupported_content`; rate limit → 429.
     The old suite (`git show backup/pre-rewrite:test/api/audit.test.ts`)
     shows the SSE-reading test pattern (`test/helpers/sse.ts` survives).
5. **Env documentation**: add `.env.example` with `ANTHROPIC_API_KEY=` +
   comment; note in your report that the var must be added to Vercel
   production (coordinator/user action — it's a secret).

## Constraints

- No new dependencies. No persistence of URL, content, or results — and no
  logging of page content (log domains + error kinds only).
- Do not modify `packages/scoring` (propose in report if you hit a wall).
- Files you own: `app/api/audit/**`, `lib/audit/**`, `lib/import/**`,
  `test/api/**`, `test/helpers/**`. Do not touch `app/page.tsx`,
  `app/audit/**`, `app/components/**`.

## Acceptance criteria

- [ ] Happy path: `curl -N -X POST localhost:3000/api/audit -d '{"url":…}'`
      with `AUDIT_TEST_MOCK=1` streams `meta`→`signals`→`scores`→`rewrites`→
      `done` (paste a trimmed transcript in the report).
- [ ] All contract §6 invariants hold (asserted by the integration test).
- [ ] SSRF checklist: every item either already-covered (cite the test) or
      newly covered (new test).
- [ ] 400/429/error-kind behavior per contract §1–2.
- [ ] No DB/auth/BYOK imports anywhere under `app/` or `lib/` (grep clean).
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.
