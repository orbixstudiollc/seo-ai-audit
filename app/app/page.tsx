import Link from "next/link";
import { LENSES, type Lens } from "@aeo/scoring";
import { listDocuments, type DocumentListItem } from "@/app/actions/documents";
import { getKeyStatuses } from "@/app/actions/keys";
import { BulkImportForm } from "@/app/components/BulkImportForm";
import { NewAuditForm } from "@/app/components/NewAuditForm";
import { NoKeysBanner } from "@/app/components/NoKeysBanner";

const LENS_LABELS: Record<Lens, string> = {
  aeo: "AEO",
  geo: "GEO",
  citability: "Cite",
  aiOverview: "AIO",
};

// Semantic red -> amber -> green, each with a redundant NON-COLOR cue so the
// scale reads for colorblind users: a fill-level glyph (full/half/empty) plus a
// word label. Color alone never carries the meaning.
type Band = { color: string; label: string; glyph: string };

function scoreBand(score: number): Band {
  if (score >= 70) return { color: "text-score-strong", label: "Strong", glyph: "●" };
  if (score >= 40) return { color: "text-score-mid", label: "Fair", glyph: "◐" };
  return { color: "text-score-weak", label: "Weak", glyph: "○" };
}

function ScoreChip({ label, score }: { label: string; score: number }) {
  const band = scoreBand(score);
  return (
    <div className="flex flex-col items-end gap-0.5" title={`${label}: ${score} — ${band.label}`}>
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-3">{label}</span>
      <span
        className={`flex items-center gap-1 font-mono text-lg font-semibold tabular-nums ${band.color}`}
      >
        <span aria-hidden className="text-xs">
          {band.glyph}
        </span>
        {score}
      </span>
      <span className="sr-only">{band.label}</span>
    </div>
  );
}

function ScoreChips({
  scores,
  eeatScore,
}: {
  scores: Record<Lens, number>;
  eeatScore: number | null;
}) {
  return (
    <div className="flex items-center gap-5">
      {LENSES.map((lens) => (
        <ScoreChip key={lens} label={LENS_LABELS[lens]} score={scores[lens]} />
      ))}
      {eeatScore !== null ? <ScoreChip label="E-E-A-T" score={eeatScore} /> : null}
    </div>
  );
}

function formatRelative(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function DocumentRow({ doc }: { doc: DocumentListItem }) {
  return (
    <li>
      <Link
        href={`/app/doc/${doc.id}`}
        className="group flex items-center justify-between gap-6 border border-line bg-surface-1 px-5 py-4 transition-colors hover:border-line-strong hover:bg-surface-2 focus-visible:border-accent-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-ink"
      >
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-text-1 group-hover:text-accent-ink">
            {doc.title}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-wider text-text-3">
            <span>{doc.source === "url" ? "URL" : "Paste"}</span>
            <span aria-hidden className="text-line-strong">
              /
            </span>
            <span className="tabular-nums">{doc.wordCount.toLocaleString()} words</span>
            <span aria-hidden className="text-line-strong">
              /
            </span>
            <span className="normal-case tracking-normal">{formatRelative(doc.updatedAt)}</span>
          </p>
        </div>

        {doc.latestScores ? (
          <ScoreChips scores={doc.latestScores} eeatScore={doc.eeatScore} />
        ) : (
          <span className="shrink-0 border border-dashed border-line-strong px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-text-3">
            Not audited
          </span>
        )}
      </Link>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="border border-line bg-surface-2 p-8 md:p-10">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-accent-ink">
        First audit
      </p>
      <h2 className="mt-3 max-w-xl text-2xl font-semibold tracking-tight">
        Paste an article to see how an AI search engine reads it.
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-text-2">
        You&apos;ll get AEO, GEO, Citability, and AI Overview scores with the
        signals behind each one — plus concrete rewrites. Audits run on your own
        OpenAI or Anthropic key.
      </p>
      <div className="mt-6 max-w-2xl">
        <NewAuditForm defaultOpen />
      </div>
    </div>
  );
}

export default async function DocumentsPage() {
  const [documents, keyStatuses] = await Promise.all([listDocuments(), getKeyStatuses()]);

  return (
    <div className="flex flex-col gap-8">
      {keyStatuses.length === 0 && <NoKeysBanner />}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-text-3">
            {documents.length === 0
              ? "No audits yet"
              : `${documents.length} ${documents.length === 1 ? "document" : "documents"}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {documents.length > 0 ? <NewAuditForm /> : null}
          {/* Always mounted, regardless of document count — unlike NewAuditForm
              (which navigates away on success, so remounting never loses
              anything), BulkImportForm shows an inline result summary after
              submit. If this were also gated on documents.length, the first
              successful bulk import would flip that condition and unmount
              this exact instance mid-result, taking the "N imported" message
              down with it before the user ever saw it. */}
          <BulkImportForm />
        </div>
      </div>

      {documents.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} />
          ))}
        </ul>
      )}
    </div>
  );
}
