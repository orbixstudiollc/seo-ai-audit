# Contributing

## Dev setup

Requirements: Node.js 20+, [pnpm](https://pnpm.io).

```bash
pnpm install
```

That is enough for the entire test suite — no database, no API keys, no env file:

- `pnpm test` runs the pure-TypeScript unit suites (scoring engine, import/export, audit derivation).
- `pnpm e2e` boots its own dev server with `AUDIT_TEST_MOCK=1` (deterministic mock LLM) — see `playwright.config.ts`.

Before opening a PR, all four must be green:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```

Scoped test runs are fine while iterating (e.g. `npx vitest run packages/scoring`), but the PR gate is the full set.

## The determinism gate (read this before touching scoring)

The product's core promise is that scores are reproducible: the same article always scores the same until a version string says otherwise. Two version constants enforce that promise:

- `SIGNALS_VERSION` — `packages/scoring/src/pipeline.ts`. Covers the deterministic half: DET signal heuristics (`src/signals/det.ts`), lens weights and hard caps (`src/weights.ts`), the parser and canonicalization (`src/parse.ts`), and parser dependencies (`remark-*`/`rehype-*`/`unified` — yes, a routine dependency bump counts if it changes AST output).
- `RUBRIC_VERSION` — `packages/scoring/src/rubricPrompt.ts`. Covers the LLM half: the rubric prompt text, the Zod response schema, quantization, and the target model tiers.

**The rule: any change that shifts scores for unchanged input MUST bump the relevant version constant in the same PR.** No silent drift. This is not bureaucracy — the audit cache key is `sha256(content) + rubric_version + model_id`, and stored audits are stamped with both versions, so a version bump is what correctly invalidates cached results instead of letting old and new scores mix.

What guards the gate:

- **Golden fixtures** — 8 hand-authored articles in `packages/scoring/fixtures/` spanning excellent → poor, with expected tiers, rank order, and per-signal reasoning in `fixtures/manifest.json`. Run them with `pnpm --filter @aeo/scoring cli -- --rank-check`. If your change reorders the fixtures or shifts their scores, either your change is wrong or it is a deliberate scoring change — in which case bump the version and update `manifest.json` expectations (with reasoning) in the same PR.
- **Weight-sum invariant** — `packages/scoring/src/weights.test.ts` asserts every lens's weights sum to exactly 100. Changing the weight table without keeping the sums fails CI.
- **Unit suites** — DET signals, parser, cache key, rubric prompt/schema all have dedicated tests under `packages/scoring/src/`. New signals need tests covering their boundary values.

## Test expectations

- **Mocked LLM only in CI.** No workflow, test, or fixture may require a real OpenAI/Anthropic key, and no real key ever belongs in CI secrets for the test gate. The mock seams are `AUDIT_TEST_MOCK=1` (app-level, `lib/audit/provider.ts` → `lib/audit/testModel.ts`) and the mock `LanguageModel` helpers (`packages/scoring/src/testModel.ts`, `test/helpers/mockModel.ts`). New LLM-touching code must stay behind those seams.
- **Vitest** (`pnpm test`): AAA structure, descriptive names ("returns X when Y"), no shared mutable state between tests.
- **Playwright** (`pnpm e2e`): deterministic waits, no timeout-based assertions; the suite must stay runnable offline.
- **Security-sensitive code** (crypto, key handling, auth) requires negative tests, not just happy paths — see `lib/crypto/apiKeys.test.ts` (wrong-AAD, tampered ciphertext, truncated blob all must throw).

## PR conventions

- **Conventional commits**: `<type>: <description>` with type one of `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.
- Keep PRs focused; a scoring change and a UI change are two PRs.
- Score-affecting PRs must contain the version bump and fixture updates (see the determinism gate above) — reviewers will block PRs that change scoring behavior without one.
- TypeScript strict: no `any`, no unchecked casts smuggled past review.
- Never log or serialize decrypted key material; all provider errors go through the choke point in `lib/audit/errors.ts` (see [SECURITY.md](SECURITY.md)).

## Reporting bugs vs. vulnerabilities

Bugs and feature requests: open a GitHub issue. Security vulnerabilities: **do not open a public issue** — follow [SECURITY.md](SECURITY.md).
