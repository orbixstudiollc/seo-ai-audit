import { AuditUrlForm } from "./components/AuditUrlForm";
import { Card } from "./components/ui/Card";

const LENSES = [
  {
    label: "AEO",
    title: "Answer Engine Optimization",
    body: "Does the page lead with a self-contained answer an AI assistant can lift verbatim?",
  },
  {
    label: "GEO",
    title: "Generative Engine Optimization",
    body: "Structure, headings, and semantic markup that make the page easy for a model to parse.",
  },
  {
    label: "Citability",
    title: "Citability",
    body: "Stat density, checkable sources, and quotable sentences an AI Overview can cite by name.",
  },
  {
    label: "AI Overview",
    title: "AI Overview readiness",
    body: "The specific blockers stopping this page from being pulled into a generated answer.",
  },
];

export default function Home() {
  return (
    <>
      <main className="flex flex-1 flex-col items-center px-6 py-20 sm:py-28">
        <div className="flex w-full max-w-2xl flex-col items-center gap-6 text-center">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-text-3">
            SEO AI Audit
          </span>
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-text-1 sm:text-5xl">
            Paste a URL. Get an AI-search audit.
          </h1>
          <p className="max-w-lg text-balance text-base text-text-2 sm:text-lg">
            Free, instant, no signup. See how ready any page is to be cited by ChatGPT, Perplexity, and
            AI Overviews — with evidence-backed findings, not guesses.
          </p>
          <AuditUrlForm />
        </div>

        <div className="mt-20 grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2">
          {LENSES.map((lens) => (
            <Card key={lens.label} label={lens.label} bodyClassName="p-4">
              <h2 className="text-sm font-semibold text-text-1">{lens.title}</h2>
              <p className="mt-1.5 text-sm text-text-2">{lens.body}</p>
            </Card>
          ))}
        </div>
      </main>
      <footer className="border-t border-line px-6 py-6 text-center font-mono text-xs text-text-3">
        No accounts. Audit history and reopenable reports are saved to a private cloud workspace with an offline browser copy.
      </footer>
    </>
  );
}
