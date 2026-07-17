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

## Sessions (standing protocol)

**Every workstream/phase gets its own fresh Conductor session.** No session
carries two workstreams; a new phase means a new session started from the
handoff prompt in `docs/HANDOFF.md`. The coordinator session persists across
phases and only plans/reviews.

## Closing ritual (every session, coordinator included)

Before wrapping up, a session MUST:

1. Update `PROJECT-STATUS.md` (repo root) so it reflects reality — status
   table row(s), pending actions, "last updated" line.
2. Append a handoff entry to `docs/HANDOFF.md` in its done/next/context
   format — a ready-to-paste prompt for the next session.

The coordinator's review loop checks both on every review pass and flags any
session that wrapped without them (verdict `changes-requested` until fixed).

## Model policy (per phase kickoff)

At each kickoff the coordinator recommends a model for the executor session,
matched to the difficulty of the work — in the spec or handoff prompt.

| Work type | Model | Examples here |
|---|---|---|
| Planning, specs, contracts, reviews, oversight | Fable (coordinator only) | phase specs, DATA-CONTRACT changes, review passes |
| Standard feature work | Sonnet | WS1 landing/scaffold, WS3 dashboard UI, Phase 4 export/share |
| Genuinely hard problems (security-critical, streaming/concurrency edges, gnarly debugging) | Opus (or strongest available) | SSRF/pinned-IP hardening, crawl scheduler design in ws4 |
| Mechanical/bulk work (renames, fixtures, doc formatting, codemods) | Haiku | fixture generation, mass import updates |

Default to Sonnet; escalate only when the task is demonstrably hard (an
executor hitting a wall is the signal), and drop to Haiku when the work is
rote. The coordinator never implements features regardless of model.
