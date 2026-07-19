# Report export and provider fallback — phase report

## Status

- [x] implemented on `phase4-dashboard-history-settings`
- [x] anonymous / no database constraint preserved
- [x] quality gates green
- [x] merged through PR #1 and deployed to production
- [x] real provider-backed audit completed through rubric and rewrite calls

## What shipped

- Single-page local exports: Markdown, standalone HTML, scores JSON, and copyable FAQ JSON-LD.
- Whole-site local exports: Markdown site summary and rollup JSON.
- Stateless single-page and whole-site share links. Opening one runs a fresh audit per D-006.
- URL-specific audit social metadata and a generated 1200×630 Open Graph image.
- A validated plain-JSON fallback for proxies that reject native structured-output/tool requests. The original Zod schemas validate fallback responses before results enter the pipeline.
- Retry classification excludes authentication, authorization, rate-limit, and provider-server failures; only structured-output capability failures retry.

## Privacy and architecture

Exports are assembled in the browser from the current report. No report body, fetched article content, provider output, or credentials are persisted. HTML safely escapes report text and JSON-LD script terminators. Share links contain only the audited URL and do not freeze or publish report data.

## Verification

```text
pnpm lint       PASS
pnpm typecheck  PASS
pnpm test       PASS — 29 files, 236 tests
pnpm build      PASS — /opengraph-image generated; audit routes dynamic
pnpm e2e        PASS — 17 Chromium journeys
```

Unit coverage includes export completeness, standalone HTML, JSON-LD script escaping, capability-error classification, schema-validated fallback parsing, and no retry on authentication errors. Browser coverage downloads Markdown and HTML and verifies the copied stateless share URL.

## Production verification

Deployment `dpl_9PsFRbmgcv3hvTCHei28ZnmVnZKD` reached Ready and was aliased to
`https://seo-ai-audit-pied.vercel.app`. Live browser probes verified the
dashboard, persistent header/settings surface, 1200×630 Open Graph image, and
a real 5,215-word Wikipedia audit. The configured proxy produced schema-valid
rubric scores (AEO 45, GEO 65, Citability 70, AI Overview 55), findings, and a
terminal `complete` record in browser-local history, proving both LLM calls and
the fallback path work end to end. The previously shared credential should
still be rotated as routine release hygiene.
