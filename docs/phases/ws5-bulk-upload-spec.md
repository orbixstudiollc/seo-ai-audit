# WS5 — Spreadsheet Bulk Upload (spec)

Status: **QUEUED — do not start until `ws4-crawl-bulk` merges to `main`.**
WS5 reuses WS4's bulk-run queue and rollup patterns; its exact API/contract
shapes are inputs to this work (read WS4's report + any DATA-CONTRACT v1.x
addendum first, and treat discrepancies between this spec and WS4's landed
design as questions for the coordinator, not silent choices).

Branch: `ws5-bulk-upload`. Read first: `docs/ARCHITECTURE.md`,
`docs/DATA-CONTRACT.md`, `docs/COORDINATION.md`, `docs/phases/ws4-*` (spec +
report, once merged). Your report: `docs/phases/ws5-report.md` (create from
the ws1–ws3 report template). Closing ritual applies (PROJECT-STATUS +
HANDOFF).

## Recommended executor model: **Sonnet**

Standard feature work: file parsing, a results table UI, and wiring onto
infrastructure that already exists (WS2's audit route, WS4's bulk queue,
WS3's report components). The security-critical and concurrency-hard pieces
(SSRF, rate limiting, queue) are inherited, not built here. Escalate to a
stronger model only if WS4's queue proves unusable as-is and queue redesign
lands in scope (that's a coordinator conversation first).

## Goal

Users upload a spreadsheet (Google Sheets export, Excel, or CSV) containing
a column of URLs — plus optional detail columns — and the product audits all
of them in bulk with a live results table, instead of pasting one URL at a
time. Anonymous, stateless, same trust model as single audits.

## (a) Expected spreadsheet format

- **File types**: `.csv`, `.tsv`, `.xlsx` (first worksheet only). Google
  Sheets users: File → Download → CSV or XLSX both work. Legacy `.xls` is
  out of scope (error message says "re-save as .xlsx or .csv").
- **URL column (required)**: detection order —
  1. header row (row 1) contains a cell matching
     `/^(url|urls|link|links|page|address|website)$/i` → that column;
  2. else the column where the largest share of non-empty cells parse as
     absolute `http(s)://` URLs (schemeless `example.com/path` counts —
     see normalization) wins, if that share ≥ 60%;
  3. else show a column-picker: preview the first 5 rows, user clicks the
     URL column.
  Header row is treated as data if it itself parses as a URL (headerless
  files are legal).
- **Optional columns**: `label` / `name` / `title` (display name for the
  row) and `notes` — detected by the same header regex approach, otherwise
  ignorable via the picker. Optional-column values stay **client-side
  only**: they are never sent to the server or the LLM (they're the user's
  private annotations, and the server has no use for them).
- **Size limits**: file ≤ 5 MB; ≤ 1,000 data rows parsed (hard stop with
  message); ≤ **50 unique URLs audited per job** (v1 row cap — see (e);
  excess rows are listed as "skipped: over row cap", not silently dropped).
  All caps are named constants in one module.

## (b) Parsing approach: client-side (decided), with server re-validation

**Parse in the browser.** Rationale: the server stays stateless (no upload
endpoint, no file storage, no multipart parsing attack surface); the
spreadsheet — which may contain private annotation columns — never leaves
the user's machine; and the server only ever receives what it already
accepts today: a list of URLs into the existing (WS4) bulk-run entry point.

- **CSV/TSV**: `papaparse` (was a dependency pre-pivot; its parsing +
  header-detection tests at `backup/pre-rewrite:lib/csv/` are a good
  starting reference, but reimplement for this shape — that code assumed
  article imports).
- **XLSX**: SheetJS `xlsx` **≥ 0.20.2 installed from the official SheetJS
  registry (`https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz`)** — the
  npm-registry copy is stale (0.18.5) with known vulnerabilities and must
  not be used. Read-only usage, first sheet, values only.
- Both parsers are **dynamically imported** on file selection so the
  landing/audit bundles stay lean. These two dependencies are
  **pre-approved by the coordinator** (this spec is the sign-off); anything
  further needs a new request.
- **Validation + normalization per row**: trim; prepend `https://` when
  schemeless but host-shaped; must parse as absolute http(s) URL ≤ 2048
  chars (same rule as `lib/audit/requestValidation.ts` — import it, don't
  duplicate). Invalid rows appear in the pre-run summary as per-row errors
  (row number + reason), never abort the whole file.
- **Dedupe**: on the normalized URL, case-insensitive host, keeping the
  first occurrence's label/notes; duplicates reported in the summary
  ("3 duplicates skipped").
- **Server trusts nothing**: every URL still goes through the existing
  server-side validation + SSRF guard exactly as a single audit does (WS2's
  route / WS4's bulk entry point already enforce this; WS5 adds no server
  parsing code at all).

## (c) Results UX — bulk results table

Route: `/bulk` (new page). Landing page gets one low-key affordance under
the URL form — "or upload a spreadsheet of URLs" (that one-line edit in
`app/page.tsx` is a sanctioned cross-boundary change; flag it in your
report per protocol).

- **Pre-run summary** (after parse, before spend): N valid / M invalid /
  K duplicates / row-cap status, the detected URL + label columns, first
  rows previewed. Explicit "Audit N pages" button — parsing must never
  auto-start a paid run.
- **Table** (one row per URL): label (if any) + URL · per-row status chip
  (`queued → fetching → scoring → done / error(kind)`) · the four lens
  mini-scores on completion (reuse `ScoreTile`'s compact form or WS4's
  rollup row treatment — match whichever WS4 shipped) · row click →
  **full single-page report** for that URL (reuse WS3's report layout /
  `AuditRunner` result view with the row's already-streamed data — no
  re-run on click).
- **Summary header**: done/total progress, average lens scores over
  completed rows, worst-N call-outs — follow WS4's site-rollup pattern so
  crawl results and bulk-upload results read as the same product surface.
- Progressive: rows update live as the queue advances; the table is usable
  (sortable by status/score) while running. Errors keep their row with the
  error kind + a single manual "retry row" affordance.
- Out of scope for WS5: exporting the bulk table, shareable bulk links,
  saved history (Phase 4 concerns — `docs/phases/later-phases.md`).

## (d) No-auth fit — queue + limits (reuse WS4)

- **Reuse WS4's bulk-run queue verbatim** — same entry point, same
  concurrency cap, same per-row status events. WS5 is "a second producer of
  URL lists" for that queue (WS4's producer is the crawler); if the queue
  API can't take an external URL list, that's a coordinator conversation,
  not a WS5 rewrite. **Hence the hard sequencing: WS5 starts after
  `ws4-crawl-bulk` merges.**
- Job state lives **client-side** (stateless server, D-001/D-008): closing
  the tab abandons the remainder of the job; completed rows' data is
  already in the page and stays. State this plainly in the UI ("keep this
  tab open — nothing is stored server-side").
- **Rate limits**: bulk rows draw from the SAME per-IP budget as single
  audits (no separate pool to farm); the per-IP daily cap therefore also
  bounds the effective job size. Respect WS4's queue concurrency (expected
  ~3 in flight) — no client-side parallel-fetch side channel around it.

## (e) Abuse / cost controls (consistent with v1)

- **Row cap**: 50 unique URLs per job (constant; coordinator tunes).
- **Budget ceiling per job**: rows × per-audit content cap is already
  bounded by WS2's ~8k-word cap; add a job-level stop — if R rows have
  errored with `rate_limit` or the per-IP budget is exhausted mid-job,
  pause the queue and surface **partial results** with a clear "resume
  when budget resets" message (partial results are a feature, not a
  failure state).
- **Junk-list rejection**: if > 50% of parsed rows are invalid URLs, reject
  the file with the per-row error list (don't burn budget on a mis-parsed
  column).
- **Retries**: max one manual retry per row; no automatic retry loops.
- Nothing bypasses WS2's server-side per-IP limiter — client cooperation is
  UX, the server limiter remains the enforcement.

## (f) Acceptance criteria + e2e outline

Acceptance:

- [ ] CSV, TSV, and XLSX fixtures (checked into `test/fixtures/bulk/`)
      parse: URL column auto-detected in the header + headerless +
      ambiguous→picker cases; labels carried through.
- [ ] Validation/dedupe: invalid rows itemized, duplicates skipped, >50%
      junk rejected, row cap enforced with skipped-rows list.
- [ ] Pre-run summary shown; no audit starts without the explicit button.
- [ ] Live table: per-row status progression, mini-scores on done, row
      click opens the full report from streamed data (no re-run).
- [ ] Partial failure: one SSRF-blocked/404 URL errors its row; the rest
      complete; rate-limit exhaustion pauses with partial results.
- [ ] Optional columns provably never leave the client (assert the request
      payloads in tests contain URLs only).
- [ ] Axe on `/bulk` (upload + table states): no critical/serious
      violations; table keyboard-navigable.
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green;
      closing ritual done (PROJECT-STATUS + HANDOFF).

E2E outline (`test/e2e/bulk-upload.spec.ts`, `AUDIT_TEST_MOCK=1`):

1. Upload the happy-path CSV fixture (5 URLs incl. 1 duplicate + 1 invalid)
   → summary shows 4 valid / 1 invalid / 1 duplicate → start → all 4 rows
   reach `done` with scores → click row 2 → full report renders.
2. Upload XLSX fixture with `URL` + `Label` headers → labels shown in table.
3. Upload headerless single-column CSV → auto-detection works.
4. Upload the junk fixture (mostly prose) → rejected with per-row errors,
   no request fired.
5. Row-cap fixture (60 URLs) → 50 audited, 10 listed as skipped.

## Ownership boundaries

Files WS5 owns: `app/bulk/**`, `app/components/bulk/**`, `lib/bulk/**`
(parsing/normalization/dedupe), `test/fixtures/bulk/**`, its tests, and its
report. One-line link edit in `app/page.tsx` (flag it). Read-only: WS4's
queue, WS2's route/validation, WS3's report components (compose, don't
fork), `packages/scoring`.
