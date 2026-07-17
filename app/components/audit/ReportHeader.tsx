import type { PageMeta } from "@/lib/audit/types";

type Props = {
  page: PageMeta;
};

export function formatFetchedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/** Report header: page title, the audited (post-redirect) URL, word count, fetch time. */
export function ReportHeader({ page }: Props) {
  return (
    <header className="flex min-w-0 flex-col gap-1.5 border-b border-line pb-4">
      <h1 className="min-w-0 text-xl font-semibold leading-snug text-text-1 sm:text-2xl">{page.title}</h1>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-wide text-text-3">
        <a
          href={page.finalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="max-w-full truncate normal-case tracking-normal text-accent-ink hover:underline"
        >
          {page.finalUrl}
        </a>
        <span aria-hidden="true">·</span>
        <span>{page.wordCount.toLocaleString()} words</span>
        <span aria-hidden="true">·</span>
        <span>fetched {formatFetchedAt(page.fetchedAt)}</span>
      </div>
    </header>
  );
}

/** Skeleton placeholder shown before the `meta` event lands. */
export function ReportHeaderSkeleton() {
  return (
    <header className="flex flex-col gap-2 border-b border-line pb-4" aria-hidden="true">
      <span className="wb-skeleton block h-6 w-2/3 rounded-sm bg-surface-3 sm:h-7" />
      <span className="wb-skeleton block h-3.5 w-1/3 rounded-sm bg-surface-3" />
    </header>
  );
}
