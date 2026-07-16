# Coordination protocol (parallel workstreams)

Three execution sessions build concurrently from the clean-slate commit on
`main`. The coordinator session reviews periodically and owns merges to
`main`.

## Branches

- `ws1-scaffold` — WS1 Scaffold + Integration (`docs/phases/ws1-scaffold-spec.md`)
- `ws2-audit-api` — WS2 Audit Engine / API (`docs/phases/ws2-audit-api-spec.md`)
- `ws3-results-ui` — WS3 Results Dashboard UI (`docs/phases/ws3-results-ui-spec.md`)

Branch from `main` at the clean slate. Do not rebase another workstream's
branch; do not push to `main` directly — the coordinator merges after review.

## Ownership boundaries (file-level, to avoid merge conflicts)

| Area | Owner | Others |
|---|---|---|
| `app/page.tsx`, `app/audit/page.tsx`, `app/layout.tsx`, `public/llms.txt`, deploy config | WS1 | read-only |
| `app/api/audit/**`, `lib/import/**`, `lib/audit/**` (route-side) | WS2 | read-only |
| `app/components/**`, `app/hooks/**`, `lib/audit/mockReport.ts` | WS3 | read-only |
| `lib/audit/types.ts` + `lib/audit/stream.ts` (contract source) | WS2 applies the exact DATA-CONTRACT edit, nothing more | read-only |
| `docs/DATA-CONTRACT.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md` | coordinator | propose changes via report |
| `docs/phases/wsN-report.md` | its workstream | — |
| `packages/scoring/**` | frozen | propose via report |

Need a change in someone else's area? Write it in your report under "Requests
across the boundary" and continue with a local workaround; the coordinator
routes it.

## Definition of done (every workstream)

1. Spec's acceptance criteria all met, each with evidence (command output,
   screenshot path, URL).
2. `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green — paste the
   tail of the output into your report.
3. Your `docs/phases/wsN-report.md` filled in: what shipped, decisions taken,
   deviations from spec (with why), open questions, requests across the
   boundary.
4. Branch pushed. The coordinator reviews the diff, may request changes, then
   merges.

## Review cadence

The coordinator reviews each branch on every report update (and periodically
regardless). Review output lands in `docs/phases/wsN-report.md` under a
`## Coordinator review` heading with verdict: `merge` / `changes-requested`
(with a numbered list).

## Integration order

WS2 and WS3 are independent (WS3 builds on the mock). WS1 ships the shell
first (deployable immediately), then wires WS3's `AuditRunner` into
`/audit` once both sides exist. Expected merge order: WS1 shell → WS2 API →
WS3 UI → WS1 final wiring commit.
