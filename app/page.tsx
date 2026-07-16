// Clean-slate placeholder. The real landing page (URL input → anonymous
// audit) is Phase 1 of the rebuild — see specs/phase-1.md.
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8">
      <h1 className="font-mono text-sm font-semibold uppercase tracking-[0.16em] text-text-3">
        seo-ai-audit — clean slate
      </h1>
      <p className="max-w-md text-center text-sm text-text-2">
        v1 rebuild in progress: an open, anonymous URL-audit tool. No accounts,
        no signup — paste a URL, get audit results.
      </p>
    </main>
  );
}
