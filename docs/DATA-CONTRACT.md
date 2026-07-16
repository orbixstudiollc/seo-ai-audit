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
