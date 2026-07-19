# DATA-CONTRACT v1 — the audit result shape

**This is the shared contract between WS2 (producer) and WS3 (consumer).**
WS1 wires the two together and may not reshape anything. Changes require a
proposal in your workstream report and coordinator sign-off; when approved,
the TypeScript source of truth (`lib/audit/types.ts`, `@aeo/scoring` types)
and this doc are updated together in one commit.

Contract version: **v1.0** (2026-07-17).

## 1. Request

```
POST /api/audit
Content-Type: application/json

{ "url": "https://example.com/some-article" }
```

- `url` must be absolute `http(s)://`, ≤ 2048 chars. Anything else → HTTP 400
  JSON `{ "error": "invalid_url", "message": "…" }` (no SSE stream started).
- Rate limited per IP. Over limit → HTTP 429 JSON
  `{ "error": "rate_limit", "retryAfter": <seconds> }`.
- Success → HTTP 200 `text/event-stream`.

## 2. SSE stream

Wire format: one JSON object per `data:` frame, frames separated by a blank
line, `: keepalive` comment frames every 15s (ignore them). Producer/consumer
helpers already exist: `lib/audit/stream.ts` (`formatAuditEvent`,
`parseAuditFrame`) — both workstreams MUST use them.

Event order: `meta` → `signals` → `scores` → `rewrites` → `done`, with
`error` possible at any point (stream ends after `error` or `done`).

```ts
// lib/audit/types.ts — v1 anonymous shape (WS2 applies this exact edit)
export type AuditStreamEvent =
  | { type: "meta"; page: PageMeta }
  | { type: "signals"; signals: Record<DetSignalId, DetSignalResult> }
  | { type: "scores"; scores: ScoreBreakdown; findings: AuditFindings }
  | { type: "rewrites"; rewrites: AuditRewrites }
  | { type: "done" }
  | { type: "error"; kind: AuditErrorKind; message: string; retryAfter?: number };

/** NEW in v1: fetched-page metadata, first event on every stream. */
export interface PageMeta {
  /** URL as submitted. */
  url: string;
  /** URL after redirects (≤3 hops), the one actually audited. */
  finalUrl: string;
  title: string;
  wordCount: number;
  /** ISO timestamp of the fetch. */
  fetchedAt: string;
}

/** v1 anonymous error kinds (replaces the BYOK set). */
export type AuditErrorKind =
  | "invalid_url"          // failed validation after stream start (rare)
  | "fetch_failed"         // network error, non-2xx, timeout, SSRF-blocked
  | "unsupported_content"  // non-HTML, no extractable article, too large
  | "rate_limit"           // per-IP bucket exhausted; retryAfter set
  | "server";              // anything else (incl. LLM provider failures)
```

`done` carries no `auditId` — nothing is persisted; the client already holds
every event. (`WorkbenchAudit`, `getAuditStatus`-style resume, and
`already_running` are all deleted concepts.)

## 3. Payload shapes (unchanged, already in the repo — do not redefine)

From `@aeo/scoring` (`packages/scoring/src/types.ts`):

- `ScoreBreakdown` = `{ lenses, signals, rubricVersion, signalsVersion, modelId }`
  - `lenses`: `Record<"aeo"|"geo"|"citability"|"aiOverview", LensScore>`;
    `LensScore` = `{ lens, score, capped, capReason? }`
  - `signals`: `Record<"S1"…"S18", SignalResult>` — S1–S11 DET
    (`{ id, score, detail }`), S12–S18 RUB (`{ id, score, evidence }`)
  - all scores 0–100, quantized to steps of 5
- `DetSignalResult.detail`: `Record<string, number | string | boolean>` — raw
  measurements for the "why this score" UI.
- `RubSignalResult.evidence`: verbatim quote or `null`.

From `lib/audit/types.ts`:

- `AuditFindings` = `{ questionGaps: string[], anchorSuggestions: {claim, suggestedSourceType}[], blockers: {issue, location}[], qaPairs: {question, answer}[], quotables: string[] }`
- `AuditRewrites` = `{ hunks: RewriteHunk[] }`;
  `RewriteHunk` = `{ id, kind: "intro"|"section"|"quotable", label, before, after, targetSignal? }`
  — rendered read-only in v1 (accept/reject editing was a workbench concept).

## 4. Client-side assembled report (what WS3 renders)

```ts
/** Everything the results page holds once the stream completes. */
export interface AuditReport {
  page: PageMeta;
  scores: ScoreBreakdown;
  findings: AuditFindings;
  rewrites: AuditRewrites | null; // null until the rewrites event lands
}
```

Stream lifecycle state for progressive rendering:
`AuditStreamPhase = "idle" | "connecting" | "streaming" | "done" | "error"`
(already in `lib/audit/types.ts`).

## 5. Canonical mock (WS3 builds against this before WS2 exists)

WS3 creates `lib/audit/mockReport.ts` exporting a complete `AuditReport`
that satisfies every rule above. Abbreviated example (make yours complete —
all 18 signals, all 4 lenses):

```json
{
  "page": {
    "url": "https://example.com/guide-to-oat-milk",
    "finalUrl": "https://example.com/guide-to-oat-milk",
    "title": "The Complete Guide to Oat Milk",
    "wordCount": 1480,
    "fetchedAt": "2026-07-17T02:00:00.000Z"
  },
  "scores": {
    "lenses": {
      "aeo":        { "lens": "aeo",        "score": 65, "capped": false },
      "geo":        { "lens": "geo",        "score": 55, "capped": false },
      "citability": { "lens": "citability", "score": 50, "capped": true,
                      "capReason": "Stat density and citation density are both near zero." },
      "aiOverview": { "lens": "aiOverview", "score": 40, "capped": true,
                      "capReason": "Answer-first intro scored below 30." }
    },
    "signals": {
      "S1":  { "id": "S1",  "score": 25, "detail": { "introAnswersInFirst2Sentences": false } },
      "S12": { "id": "S12", "score": 60, "evidence": "Oat milk is a plant-based milk made from…" }
    },
    "rubricVersion": "rubric-v3",
    "signalsVersion": "signals-v2",
    "modelId": "mock-model"
  },
  "findings": {
    "questionGaps": ["Is oat milk gluten-free?"],
    "anchorSuggestions": [{ "claim": "Oat milk sales doubled in 2025",
                            "suggestedSourceType": "industry sales report" }],
    "blockers": [{ "issue": "No self-contained answer block in the intro",
                   "location": "Introduction" }],
    "qaPairs": [{ "question": "What is oat milk?", "answer": "Oat milk is…" }],
    "quotables": ["Oat milk contains roughly 2–3g of fiber per cup."]
  },
  "rewrites": { "hunks": [{ "id": "h1", "kind": "intro",
    "label": "Answer-first intro", "before": "…", "after": "…",
    "targetSignal": "S1" }] }
}
```

For realistic values, mine `lib/audit/e2eFixture.ts` and the scoring test
fixtures (`packages/scoring/fixtures/`) plus the mock model
(`lib/audit/testModel.ts`, `AUDIT_TEST_MOCK=1`).

## 6. Invariants both sides may rely on

1. `meta` is always the first event; `signals` always precedes `scores`.
2. Every signal id S1–S18 is present in `scores.signals`; every lens key is
   present in `scores.lenses`.
3. Scores are integers 0–100 in steps of 5.
4. `findings` arrays are bounded (≤10 items each) and may be empty, never
   missing.
5. After `error`, no further events arrive; the client keeps whatever partial
   data it already rendered.
6. The stream never exceeds ~120s; the route enforces `maxDuration = 300`.

## 7. Bulk site-crawl (v1.1, additive — WS4, 2026-07-17)

**Purely additive.** Nothing in §1–§6 changed; `/api/audit` and every existing
consumer are untouched. This section documents a second, independent
endpoint and event union for whole-site audits.

```
POST /api/audit/bulk
Content-Type: application/json

{ "url": "https://example.com", "limit": 500 }
```

- `url`: same validation as §1. `limit`: optional, 1–500 (`DISCOVERY_HARD_MAX`),
  defaults to 500 (`DISCOVERY_DEFAULT_LIMIT`).
- Rate limited per IP (stricter than §1 — a crawl audits up to 500 pages, each
  spending 2 LLM calls) and limited to one concurrent crawl per IP. Over
  either limit → HTTP 429 JSON `{ "error": "rate_limit" | "concurrent_site_limit", ... }`.
- Success → HTTP 200 `text/event-stream`, same wire format as §2
  (`formatSiteAuditEvent`/`parseSiteAuditFrame` in `lib/audit/stream.ts`).

```ts
// lib/audit/types.ts — additive; AuditStreamEvent itself is untouched.
export type SiteAuditStreamEvent =
  | { type: "site:discovery-start"; rootUrl: string }
  | { type: "site:discovery-done"; rootUrl: string; method: "sitemap" | "crawl";
      pages: DiscoveredPageInfo[]; truncated: boolean }
  | { type: "site:page-start"; url: string; index: number; total: number }
  | { type: "site:page-event"; url: string; index: number; event: AuditStreamEvent }
  | { type: "site:page-done"; url: string; index: number; status: "ok" | "error" }
  | { type: "site:rollup"; rollup: SiteRollup; stoppedEarly: StoppedEarlyInfo | null }
  | { type: "site:done" }
  | { type: "site:error"; kind: SiteErrorKind; message: string; retryAfter?: number };
```

`site:page-event` wraps the **exact same** `AuditStreamEvent` a single
`/api/audit` call would stream for that URL — the bulk pipeline calls
`lib/audit/pageAudit.ts`'s `runPageAudit` verbatim per page (the function
`/api/audit` itself calls); there is no second implementation of the
single-page pipeline to drift out of sync with this one.

Event order: `site:discovery-start` → `site:discovery-done` → interleaved
`site:page-start`/`site:page-event`(×N)/`site:page-done` per page, up to
`SITE_MAX_CONCURRENCY` (3) at once → `site:rollup` → `site:done`, with
`site:error` possible in place of everything after `site:discovery-start` if
the crawl fails outright (bad root URL, zero pages found).

```ts
export interface DiscoveredPageInfo { url: string; source: "sitemap" | "crawl"; }

export interface SiteRollup {
  pagesAudited: number;
  pagesFailed: number;
  avgScores: Record<Lens, number> | null; // mean of each lens across scored pages; null if none scored
  worstPages: { url: string; title: string; overallScore: number }[]; // lowest overall score first, ≤5
  commonFindings: { issue: string; count: number }[]; // AI-Overview blockers recurring on 2+ pages, ≤5
}

export interface StoppedEarlyInfo { reason: "budget" | "page_cap" | "timeout"; pagesRemaining: number; }

export type SiteErrorKind =
  | "invalid_url" | "no_pages_found" | "rate_limit" | "concurrent_site_limit" | "server";
```

**Abuse/cost controls** (`lib/audit/siteGuards.ts`, `app/api/audit/bulk/route.ts`):

- Discovery is capped at `limit` pages (≤500 hard max) — `lib/discovery`.
- Per-IP: 1 concurrent crawl, 2/hour, 5/day (vs. §1's 5/min, 20/day per page).
- A wall-clock budget (240s) stops the queue from starting new pages once
  spent — in-flight pages are left to finish, not killed. `site:rollup`
  carries `stoppedEarly` when this fires; **partial results are still a
  successful run** (`site:done`, not `site:error`) — every page that
  completed before the ceiling is real, scored data.
- Each page gets its own 45s hard timeout, raced independently of the
  others — one stuck page cannot stall the queue past its own slot.

**Same SSRF guard, larger surface.** Every fetch discovery makes — robots.txt,
sitemap.xml (+ index children), every crawled page, every page audited — goes
through `lib/import/ssrfGuard.ts`'s pinned dispatcher (§ARCHITECTURE.md
constraint 4), the same one `/api/audit` uses for its single fetch.
