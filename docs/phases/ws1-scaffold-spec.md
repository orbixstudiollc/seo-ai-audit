# WS1 — Scaffold + Integration (spec)

Branch: `ws1-scaffold`. Read first: `docs/ARCHITECTURE.md`,
`docs/DATA-CONTRACT.md`, `docs/COORDINATION.md`. Your report:
`docs/phases/ws1-report.md`.

## Goal

The public shell of the anonymous tool: a landing page with a URL input that
routes into the audit results page, deployed and **verifiably reachable** on
Vercel. This ships first and independently — the audit itself may still be a
stub behind it.

## Context you need

- Next.js 16.2.10 App Router, React 19, Tailwind 4. Current `app/` has only a
  placeholder `page.tsx`, `layout.tsx`, `robots.ts`, `globals.css`.
- Design system: light Swiss/editorial, tokens + utilities in
  `app/globals.css` (`bg-surface-*`, `text-text-*`, `border-line`,
  `text-accent-ink`…), primitives `app/components/ui/Button.tsx` and
  `Card.tsx`, Geist Sans/Mono already wired in `layout.tsx`. No dark theme.
- Vercel project: `seo-ai-audit`, team `orbix2`
  (`prj_mRVyPhFrSAqvjgN4xqnyHZYg8XTJ`, linked in `.vercel/project.json`).
  Framework preset must stay `nextjs` (see D-007 in `docs/DECISIONS.md`).

## Tasks

1. **Landing page `/`** (server component + one small client form):
   - Hero: product name, one-line pitch ("Paste a URL. Get an AI-search
     audit. No signup."), the URL input front and center — the input IS the
     hero. A terminal-style monospace flourish fits the design system.
   - Form (client component `app/components/AuditUrlForm.tsx`): one text
     input + submit. Client-side validation: absolute `http(s)://` URL
     (try `new URL()`, check protocol), ≤2048 chars. Invalid → inline error
     text (`aria-describedby`), no navigation. Valid →
     `router.push("/audit?url=" + encodeURIComponent(url))`.
   - Below the fold: 3–4 short cards explaining what gets audited (the four
     lenses: AEO, GEO, Citability, AI Overview — copy can crib from
     README.md). No pricing, no signup CTAs, no fake testimonials.
2. **Results page shell `app/audit/page.tsx`**:
   - Reads `url` from `searchParams`, re-validates server-side; missing or
     invalid → redirect to `/`.
   - Renders page frame (header with the audited URL, back link) around a
     mount point for WS3's results component. Until WS3 merges, render the
     stub: "Audit engine wiring lands with WS2/WS3" + the validated URL.
     Structure it so the final wiring is a one-import swap.
3. **`public/llms.txt`** — short structured description of the site for AI
   crawlers: what the tool does, main routes, how to use it.
4. **Metadata** in `app/layout.tsx` / per-page: title, description,
   OpenGraph + Twitter card basics. `robots.ts` already allows all.
5. **E2E** (`test/e2e/landing.spec.ts`, Playwright config already boots the
   dev server):
   - `/` renders: h1 visible, form focusable.
   - Invalid input ("not a url") → error shown, stays on `/`.
   - Valid input → lands on `/audit?url=…` and shows the audited URL.
   - Axe scan on `/`: no critical/serious violations
     (`@axe-core/playwright` is installed; copy the pattern from git history
     `backup/pre-rewrite:test/e2e/workbench.spec.ts`).
6. **Deploy to Vercel production** and verify per D-007:
   `curl -sS -o /dev/null -w "%{http_code}"` on `/` == 200, body of `/`
   contains the hero h1 text, `/robots.txt` == 200. Paste the outputs in your
   report. If the production alias still times out (last known state), check
   the deployment's own `*.vercel.app` URL first to isolate alias vs build,
   and escalate in your report if it's an account/alias issue.

## Constraints

- No new dependencies without coordinator sign-off (you shouldn't need any).
- Don't touch `app/api/**`, `lib/**`, `packages/**`, `app/components/ui/**`
  (read-only for you; the form component is yours).
- Landing page JS budget: this is a static page with one tiny client island —
  keep it that way (<25KB first-load JS beyond the framework baseline).
- Semantic HTML (header/main/footer, labeled form), keyboard reachable,
  visible focus states (the `Button` primitive already has them).

## Acceptance criteria

- [ ] `/` shows hero + working URL form, styled with the existing tokens.
- [ ] Invalid URL → inline error; valid URL → `/audit?url=…`.
- [ ] `/audit` shell validates the param and renders the frame + stub.
- [ ] `public/llms.txt` served at `/llms.txt`.
- [ ] E2E + axe specs pass locally (`pnpm e2e`).
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.
- [ ] Production URL returns 200 with the real landing HTML (evidence in
      report).
