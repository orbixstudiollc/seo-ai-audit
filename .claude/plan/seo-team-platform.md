# Implementation Plan: SEO Team Platform — Skills, Agent Mode, DataForSEO + GSC + GA4

Generated 2026-07-20 by the coordinator session (Fable) from a 4-agent parallel
analysis (backend/data-integration, frontend/UX, SEO-domain, adversarial
security/cost critic — Workflow run `wf_6a2db548-eb0`, 4/4 completed, findings
cross-validated). The `ccg-workflow` runtime (Codex/Gemini backends) is not
installed, so there are no CODEX_SESSION/GEMINI_SESSION ids; the multi-agent
analysis above replaced that step. Execution is designed for **independent
parallel agents** (`/multi-execute` or fresh Conductor sessions per
workstream, per `docs/COORDINATION.md`).

### Task Type
- [x] Fullstack (parallel backend + frontend workstreams against frozen contracts)

## Base facts (verified in repo @ `0e8fad0`)

- Live product: single-page + 500-page site audits (SSE), dashboard/history/
  settings, Supabase durable store (server-only RLS, owner-hash model),
  optional email-link accounts, DataForSEO on-page crawl with cost ledger
  (`lib/dataforseo/client.ts`, `app/api/technical-audit`), provider-flex LLM.
- claude-seo v2.2.0 is now installed locally (`~/claude-seo` clone +
  `~/.claude/skills/seo*`): implementers can read the real SKILL.md rubrics,
  scoring tables, and scripts as reference material, and run `/seo*` skills
  for QA comparisons.
- The engine (`packages/scoring`, 18 signals, 4 lenses) is FROZEN (D-003).
  All new features consume its output; nobody edits it.

## Skill triage (commit to DECISIONS.md as D-014)

- **Already covered by the product** (don't rebuild): GEO/AI-search, E-E-A-T
  content quality, single-page deep analysis, schema *detection*, whole-site
  technical crawl.
- **Build (high value / feasible)**: 4-tier severity action plan · drift
  monitoring (baseline/compare) · schema validate+generate · sitemap validate ·
  hreflang checks · image-optimization checks · SXO page-type mismatch ·
  SERP-grounded competitor compare · topic clusters (SERP overlap) · content
  briefs · keyword/backlink data panels · GSC/GA4 insights.
- **Defer** (needs new paid surfaces/marginal for this team): local SEO pack,
  maps intelligence, e-commerce pack, programmatic SEO, FLOW framework,
  image generation, IndexNow.

## Technical solution (consensus of all four analysts)

1. **Contracts before code.** Additive DATA-CONTRACT v1.2: a generic
   `SkillTask` envelope generalizing `TechnicalAuditTask`
   (`{ id, skillId, scope{kind:'page'|'site',url}, status, costUsd?, resultVersion, result }`),
   provider-task `request_fingerprint` idempotency, `agent:*` SSE event union
   (plan → skill events/handoffs → rollup), `GoogleConnectionStatus`,
   GSC/GA4 normalized result shapes, insights shape — plus canonical fixture
   mocks for every shape (the proven WS3-vs-mockReport pattern).
2. **Spend-gating before any new paid endpoint.** `usage_ledger` is currently
   write-only and `/api/technical-audit` has **no rate limiting**; device
   tokens are freely mintable. Add a budgets table + `reserve_spend`/`settle`
   security-definer RPC (per-owner AND global daily caps from env), extract
   `lib/providers/taskStore.ts` + `budget.ts` from the technical-audit route
   (fixing its reservation-delete race), per-IP limit on technical-audit now,
   Supabase-backed counters for paid paths (supersedes D-008 for paid routes).
3. **Google integrations are account-gated.** OAuth refresh tokens must never
   bind to anonymous device tokens (orphaned + unrevokable). Flow: state-nonce
   table bridges the cookie-less callback; tokens AES-256-GCM encrypted with a
   dedicated env key; server-only RLS tables; `claim_anonymous_workspace` RPC
   updated in the SAME migration; revoke-at-Google on disconnect; retention +
   purge endpoint. **Consent-screen verification (sensitive scopes) takes
   weeks — file it in week 1 as ops work.**
4. **Agent mode = durable hybrid runs, not one long SSE stream.** Fast skills
   resolve inline in the agent SSE; slow/provider skills hand off to polled
   `SkillTask`s (the proven TechnicalSeoPanel loop). Run state persists in
   Supabase (generalized provider_tasks); per-run caps on steps/tokens/cost;
   estimated cost shown before fan-out; saved reports complete progressively.
5. **UI generalizes what exists**: `SkillPanel` shell from `TechnicalSeoPanel`;
   agent report mirrors `SiteAuditReportView`; insights home is server-fetched
   ranked editorial lists (declining pages, striking-distance keywords) — not
   KPI cards; `/settings/integrations` full page; `/site/[host]` hub later.
   Renderers compose only existing primitives (Card/Button/SeverityChip/
   ScoreTile/DiffHunk/FindingsDrawer) — no new colors/status vocabularies.

## Implementation steps — small workstreams for independent agents

### Wave 0 — foundations (start immediately; F1 by coordinator)

| WS | Scope | Deliverable | Model |
|---|---|---|---|
| **F1-CONTRACT** | DATA-CONTRACT v1.2 additive sections + type stubs + fixture mocks (SkillTask, agent:* union, connections, GSC/GA4, insights) | Frozen contract every other WS builds against | Fable (coordinator) |
| **F2-BUDGET** | budgets table + reserve/settle RPC, `lib/providers/taskStore.ts` + `budget.ts` extraction, fingerprint idempotency + claim-RPC update in one migration, race fix, per-IP limit on technical-audit | Every paid caller uses one guarded helper; verified by tests incl. concurrent reservation | **Opus** (security-critical) |
| **F3-OPS** | Google Cloud consent screen + verification kickoff (privacy-policy page, scope justification), env rollout (`GOOGLE_*`, `PROVIDER_*_DAILY_USD`, `GOOGLE_TOKEN_ENC_KEY`), db-wipe.sql guard/archive, D-014/D-015 decision records | Verification submitted; envs staged; footgun removed | Sonnet (+ user for Google account steps) |

### Wave 1 — parallel, mock-first (after F1 lands; F2 stubs OK)

| WS | Scope | Depends on | Model |
|---|---|---|---|
| **W1-DFS** | `lib/dataforseo/{serp,keywords,backlinks,labs}.ts` over the existing transport (live endpoints, typed normalizers, row caps, cost capture) + budget-guarded routes | F1 shapes; F2 helper (stubbable) | Sonnet |
| **W2-GOOGLE** | `oauth_states` + `google_connections` migrations, start/callback/status/disconnect routes, `lib/google/tokens.ts` (AES-GCM, refresh, invalid_grant), account gate, purge/revoke | F1; F3 credentials | **Opus** (token custody) |
| **W3-SHELL** | Generic `SkillPanel` + `/dev/mock-skills`, third "agent" mode on AuditUrlForm (stub), design-guardrail checklist | F1 fixtures only | Sonnet |
| **W4-DET-SKILLS** | Deterministic skill backends, one route+renderer pair each: schema validate/generate, sitemap validate, hreflang, image checks, SXO page-type heuristics (reuse ssrfGuard fetch + scoring parse; adapt dormant SchemaBlock/DiffHunk) | F1 envelope | Sonnet (parallelizable per-skill; Haiku for fixtures) |
| **W5-ACTION-PLAN** | Pure-TS 4-tier severity synthesizer over existing findings/cap-reasons/rollups/issueKeys + report section + export | Nothing new — existing data | Sonnet (small, ship first) |

### Wave 2 — parallel (after wave-1 contracts merge)

| WS | Scope | Depends on | Model |
|---|---|---|---|
| **W6-GSC-GA4** | Properties discovery + selection, `gsc/query` + `ga4/report` routes (zod allowlists, rowLimit caps), zero-cost snapshot caching per property/day | W2 (two-function token contract, stubbable) | Sonnet |
| **W7-AGENT** | `/api/audit/agent` orchestrator (detect type → select skills → fan-out via envelope, budget-guarded, hybrid inline/handoff), `useAgentStream`, AgentReportView | F1, F2, W3; runs on mock skills first | **Opus** (orchestration/limits) |
| **W8-COMPETE** | Keyword → top-N SERP URLs → 18-signal audit each (existing bulk path) → side-by-side compare; SERP-overlap topic clusters; content-brief generator (S13 gaps + keyword ideas) | W1-DFS (fixtures until merge) | Sonnet |
| **W9-INSIGHTS** | `/api/insights` (owner-scoped, server-fetched) + insights home as ranked lists with re-audit deep links; History stays as-is | F1 mockInsights; W6 for real data | Sonnet |
| **W10-DRIFT** | Baseline snapshot per URL/site from existing audit_runs, compare view (strict-DET exact, ±5 tolerance for RUB/fuzzy-DET, rubric-version pinning), weekly cron for signed-in workspaces | Existing storage only | Sonnet |

### Wave 3 — after waves 1–2 prove out

`/site/[host]` hub (site-centric anchor: latest scores, run strip, drift,
connected GSC/GA4 tiles) · backlinks report panel · PSI/CrUX free tile ·
GSC-decay × drift join · defer-list revisit.

## Key files (anchor points, per analysts)

| File | Role |
|---|---|
| `app/api/technical-audit/route.ts` | Template for all provider routes; extract taskStore/budget from it; fix race; add rate limit |
| `lib/dataforseo/client.ts`, `types.ts` | Shared transport + normalizer pattern for W1-DFS |
| `lib/cloud/{owner,server,request}.ts` | Owner-hash + account resolution; integrations gate on the bearer path |
| `supabase/migrations/2026072000{01,02,03}*.sql` | RLS posture + claim-RPC that every new table must join |
| `app/components/audit/TechnicalSeoPanel.tsx`, `SiteAuditReportView.tsx`, `AuditReportView.tsx` | UX patterns to generalize (SkillPanel, agent report, renderers) |
| `packages/scoring/src/*` | FROZEN engine; consume only |
| `docs/DATA-CONTRACT.md` | The law; v1.2 additions land first |

## Risks and mitigation (consolidated, severity-ranked)

| Risk | Mitigation |
|---|---|
| **Anonymous wallet-drain** (mintable device tokens + write-only ledger + un-rate-limited technical-audit + new per-call paid APIs) | F2 before any new paid endpoint: budget RPC (owner + global caps), per-IP limit now, account-gating for new paid surfaces |
| **Google token custody** (refresh tokens = most sensitive data ever stored) | Account-gated connect, AES-256-GCM app-layer encryption (dedicated env key), server-only RLS, revoke-on-disconnect, никогда in logs/responses; security review before deploy |
| **OAuth verification lead time** (sensitive scopes, 2–6 weeks, 100-user cap unverified) | F3 files it week 1; everything else proceeds; test with internal users meanwhile |
| **Agent runs exceed serverless limits** (bulk already needs 240s budget) | Hybrid inline + polled SkillTask contract from day one; durable step state; resumable like per-page retry |
| **Login-CSRF on cookie-less OAuth callback** | Single-use 256-bit state nonce in owner-bound table, 10-min TTL |
| **Contract/design drift across N parallel sessions** | F1 frozen first + fixture mocks; renderers restricted to existing primitives; coordinator review per protocol |
| **Drift-monitor false alarms** (fuzzy signals, LLM variance) | Exact diff for strict-DET only; ±5 quantum tolerance elsewhere; rubric-version pinning; alert on correlated drops |
| **Google/DataForSEO quota exhaustion** | Per-property daily snapshot caching; one provider call per invocation; "data as of" provenance |
| **Limited-Use policy on GSC/GA4 data** | Retention window + purge endpoint; LLMs get derived aggregates only; disclosed in the privacy policy the verification requires |
| **Scope creep across 20+ skills** | D-014 triage table recorded; deferred skills need a new decision to enter scope |

## Execution process

- One fresh session per workstream (COORDINATION.md protocol), branch
  `wsp-<name>`, mock-first, gates green, closing ritual (PROJECT-STATUS +
  HANDOFF) — coordinator reviews and merges.
- `/multi-execute` compatible: each wave's workstreams are independent; hand
  each row of the tables above to its own agent with this file + F1's
  contract section as the spec seed. No workstream blocks another inside its
  wave.
- Model policy applied per `docs/COORDINATION.md`: Sonnet default; Opus only
  for F2 (spend-gating), W2 (token custody), W7 (orchestrator); Haiku for
  fixtures/mechanical work.

### SESSION_ID (for /ccg:execute)
- CODEX_SESSION: n/a (ccg-workflow runtime not installed; `npx ccg-workflow` to enable)
- GEMINI_SESSION: n/a — analysis performed by Workflow `wf_6a2db548-eb0` (4 agents, results in the session transcript)
