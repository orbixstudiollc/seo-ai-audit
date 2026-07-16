# Vision vs. Implementation — Gap Analysis

Generated 2026-07-17. Method: read every doc in the repo, cross-referenced against a direct inventory of `app/`, `lib/`, `db/schema.ts`, and the test suite — not a summary of claims, each row below was checked against actual code or a live query.

## 1. Docs inventoried

| Doc | Role |
|---|---|
| `README.md` | Primary vision/feature doc — what the product claims to do, architecture map, self-host quickstart |
| `CONTRIBUTING.md` | Dev workflow, the "determinism gate" for scoring changes, PR conventions |
| `SECURITY.md` | BYOK crypto design, SSRF guard, threat model, self-hosting responsibilities |
| `DEPLOYMENT.md` | Supabase + Vercel deploy walkthrough, explicit "Known ceilings" section |
| `.context/attachments/.../Transcript of Validate Build Plan.md` | Informal build history — original plan, pivots (dashboard-only/OSS pivot), PM/SQA validation findings |
| `.context/attachments/.../Review request.md` | **Not a vision doc** — a code-review-instruction template for Conductor's diff-comment feature, unrelated to this app. Noted, not used. |

**No formal PRD, roadmap, or CEO-vision document exists in this repo.** `README.md` is the closest thing to a vision statement (it's descriptive/aspirational about capability, not just usage docs). The build transcript is the only record of deferred scope decisions — none of those decisions are reflected in current docs.

## 2. Implementation inventory (verified, not assumed)

- **Routes**: `/`, `/login`, `/signup`, `/app` (doc list), `/app/doc/[id]` (workbench), `/app/settings`, `/robots.txt`
- **API**: `/api/audit` (SSE), `/api/keys`, `/api/auth/[...all]` (better-auth), `/api/demo-login` + `/api/test/seed` (both dev-only, gated on `E2E_PGLITE=1`)
- **Server actions**: `audit.ts`, `bulkImport.ts`, `documents.ts`, `import.ts`, `keys.ts`
- **DB schema** (live-verified against the real Supabase project): `user`, `session`, `account`, `verification` (better-auth), `apiKeys`, `documents`, `audits` — 7 tables, matches `db/migrations/0000`–`0003` exactly
- **Scoring engine** (`packages/scoring/`): isomorphic, 18-signal pool, golden-fixture rank-check, weight-sum test
- **Test suite**: 219/219 vitest (23 files), 3/3 Playwright e2e (1 pre-existing workbench journey + 2 I added this session for signup/login, which had zero prior coverage)

## 3. Gap report (ranked by impact)

### High impact

| Vision item | Status | Evidence |
|---|---|---|
| **`.env.example` for self-host quickstart** | **Missing** | README and SECURITY.md both instruct `cp .env.example .env` and state "only `.env.example` with placeholders is committed" — `git ls-files \| grep -i env` returns nothing. Following the documented quickstart literally fails at step 1. |
| **CI/CD (GitHub → Vercel auto-deploy)** | **Missing** | Confirmed directly this session: the Vercel account has no GitHub login connection, so the linked project deploys only via manual CLI `vercel deploy`. Every future code change requires a person to redeploy by hand — a real gap for an "OSS, self-hostable" project expecting outside contributors. |
| **CSP / security headers** | **Missing** | `grep` for `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options` across `next.config.ts`, `middleware.ts`, `app/` returns zero matches. Self-documented in `DEPLOYMENT.md`'s "Known ceilings" as not done — a real gap, but at least an honest one. |

### Medium impact

| Vision item | Status | Evidence |
|---|---|---|
| **Plan Mode** (from original build plan) | **Missing, undocumented** | Mentioned only in the build transcript as "cut to a v1.1 fast-follow." Zero references anywhere in current README/CONTRIBUTING/DEPLOYMENT/SECURITY or code — a silently dropped vision item with no trace for a future contributor to find. |
| **Internal-linking blueprint** (from original build plan) | **Missing, undocumented** | Same as above — mentioned once in the transcript, zero references in current docs or code. |
| **Rate limiting beyond single-instance** | **Partial (self-documented)** | `lib/audit/ratelimit.ts` is in-memory/per-instance by design; README's own "Deployment notes" section and `SECURITY.md` both flag this explicitly as a scaling ceiling, not a surprise. Correct for the stated single-instance target, but blocks horizontal scaling without a swap to a shared counter. |
| **Auth flow test coverage** | **Was Missing, now Done** | Every existing test (including the one e2e spec) bypassed real signup/login via a `/api/test/seed` shortcut. I found this gap and closed it this session (`test/e2e/authFlow.spec.ts`, 2/2 passing) — flagging it here since it was a real, previously-invisible gap in the "vision" of testing rigor `CONTRIBUTING.md` describes. |

### Low impact / Done, no gap

| Vision item | Status | Evidence |
|---|---|---|
| Four-lens scoring (AEO/GEO/Citability/AIO) with evidence quotes | **Done** | 18-signal pool, weight-sum-100 unit test, hard caps, versioned + cached — matches README exactly. |
| Rewrites, instant estimated re-score, true re-score | **Done** | Verified live via Playwright e2e (accept rewrite → estimated re-score → true re-score, all pass). |
| Export: markdown/HTML + JSON-LD + roadmap | **Done** | `lib/export/{html,markdown,roadmap}.ts` + `ExportMenu.tsx` all present and wired. |
| BYOK crypto (AES-256-GCM, per-user AAD, key versioning) | **Done** | Matches `SECURITY.md` exactly; negative tests exist for tampered/wrong-AAD ciphertext. |
| Custom provider support (OpenAI/Anthropic-compatible) | **Done** | `lib/keys/types.ts` + `lib/audit/provider.ts` fully implement the 3rd provider type end-to-end. |
| URL import + SSRF guard | **Done** | `lib/import/ssrfGuard.ts` implements deny-lists, redirect re-checking, size/time caps — matches `SECURITY.md` claim exactly, with bypass tests. |
| Bulk CSV upload | **Done** | Later addition per build history; fully implemented (`lib/csv/`, `bulkImport.ts`, `BulkImportForm.tsx`), tested. |
| Google OAuth (optional) | **Done** | Correctly gated on both env vars being present in both login and signup pages. |
| E-E-A-T chip on documents overview | **Done** | Later addition; confirmed rendering in `app/app/page.tsx`. |
| Demo login | **Done, correctly scoped** | Gated to `E2E_PGLITE=1` only — 404s in any real deployment, as intended. |

## Top 3 to act on first

1. **Add the missing `.env.example`** — cheapest fix here, directly unblocks the documented self-host quickstart for anyone who isn't you.
2. **Connect GitHub to the Vercel account** and re-link the project for auto-deploy-on-push — currently every change requires a manual `vercel deploy`.
3. **Decide Plan Mode / internal-linking's fate explicitly** — either drop them from the original plan for real (and note it somewhere a future contributor can find, e.g. a `ROADMAP.md` or an issue) or scope them as real fast-follow work. Right now they exist only as a throwaway line in a chat transcript, which isn't discoverable by anyone else.
