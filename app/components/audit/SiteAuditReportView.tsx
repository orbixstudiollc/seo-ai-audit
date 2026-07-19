"use client";

import { useState } from "react";
import type {
  DiscoveredPageInfo,
  DiscoveryMethod,
  SiteAuditStreamPhase,
  SiteErrorKind,
  SiteRollup,
  StoppedEarlyInfo,
} from "@/lib/audit/types";
import type { PageRunState } from "@/app/hooks/useSiteAuditStream";
import { LENS_META, LENS_ORDER } from "@/lib/audit/signalMeta";
import { scoreBand } from "@/lib/audit/scoreScale";
import { Card } from "@/app/components/ui/Card";
import { Button } from "@/app/components/ui/Button";
import { ScoreTile } from "@/app/components/ui/ScoreTile";
import { AuditReportView } from "./AuditReportView";
import { SiteReportActions } from "./SiteReportActions";

type StreamError = { kind: SiteErrorKind; message: string; retryAfter?: number };

type Props = {
  phase: SiteAuditStreamPhase;
  rootUrl: string | null;
  method: DiscoveryMethod | null;
  discoveredPages: DiscoveredPageInfo[];
  truncated: boolean;
  pages: Record<string, PageRunState>;
  pageOrder: string[];
  rollup: SiteRollup | null;
  stoppedEarly: StoppedEarlyInfo | null;
  error: StreamError | null;
  onRetry: () => void;
};

const SITE_ERROR_LABEL: Record<SiteErrorKind, string> = {
  invalid_url: "That URL doesn't look valid.",
  no_pages_found: "No pages were found to audit on this site.",
  rate_limit: "Too many site audits — try again shortly.",
  concurrent_site_limit: "A site audit is already running.",
  server: "Something went wrong running the site audit.",
};

function pageStatus(page: PageRunState | undefined): { label: string; glyph: string; colorVar: string } {
  if (!page || page.phase === "idle" || page.phase === "connecting") {
    return { label: "Queued", glyph: "·", colorVar: "var(--text-3)" };
  }
  if (page.phase === "error") return { label: "Failed", glyph: "✕", colorVar: "var(--score-weak)" };
  if (page.phase === "done") return { label: "Done", glyph: "✓", colorVar: "var(--score-strong)" };
  return { label: "Auditing", glyph: "•", colorVar: "var(--accent-ink)" };
}

function overallScore(page: PageRunState | undefined): number | null {
  if (!page?.scores) return null;
  const values = LENS_ORDER.map((lens) => page.scores!.lenses[lens].score);
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/**
 * Whole-site progressive report: discovery status -> page list with
 * per-page status/score as results stream in -> site-level rollup -> click
 * any finished page to drill into its full report, reusing AuditReportView
 * (WS3) verbatim so a page's drill-in view looks identical to a direct
 * single-URL audit of that same page.
 */
export function SiteAuditReportView(props: Props) {
  const { phase, rootUrl, method, discoveredPages, truncated, pages, pageOrder, rollup, stoppedEarly, error, onRetry } = props;
  const [openPageUrl, setOpenPageUrl] = useState<string | null>(null);

  if (openPageUrl) {
    const page = pages[openPageUrl];
    return (
      <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-3 px-4 py-6 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => setOpenPageUrl(null)}
          className="w-fit font-mono text-xs uppercase tracking-wider text-accent-ink hover:underline"
        >
          ← Back to site overview
        </button>
        <AuditReportView
          phase={page?.phase ?? "idle"}
          page={page?.page ?? null}
          signals={page?.signals ?? null}
          scores={page?.scores ?? null}
          findings={page?.findings ?? null}
          rewrites={page?.rewrites ?? null}
          error={page?.error ?? null}
          // ponytail: bulk has no per-page re-run endpoint, so "Run again" on a
          // drilled-in page re-runs the whole site — acceptable here since the
          // "← Back to site overview" link keeps that context visible.
          onRetry={onRetry}
        />
      </div>
    );
  }

  const isDiscovering = phase === "connecting" || phase === "discovering";

  return (
    <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg,5px)] border px-3.5 py-3"
          style={{ borderColor: "var(--score-weak)", backgroundColor: "var(--score-weak-tint)" }}
        >
          <p className="text-[13px] leading-snug" style={{ color: "var(--score-weak)" }}>
            <span className="font-medium">{SITE_ERROR_LABEL[error.kind]}</span> {error.message}
          </p>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Run again
          </Button>
        </div>
      )}

      {isDiscovering && (
        <Card label="Discovery">
          <p className="wb-skeleton px-3.5 py-3 font-mono text-xs text-text-3">
            {rootUrl ? `Discovering pages on ${rootUrl}…` : "Connecting…"}
          </p>
        </Card>
      )}

      {discoveredPages.length > 0 && (
        <Card
          label={`Pages (${discoveredPages.length}${truncated ? "+" : ""})`}
          aside={
            <span className="font-mono text-[10px] uppercase tracking-wider text-text-3">
              {method === "sitemap" ? "via sitemap" : "via link crawl"}
            </span>
          }
        >
          <ul className="divide-y divide-line">
            {pageOrder.map((url) => {
              const page = pages[url];
              const status = pageStatus(page);
              const score = overallScore(page);
              const canOpen = page?.phase === "done" || page?.phase === "error";
              return (
                <li key={url}>
                  <button
                    type="button"
                    disabled={!canOpen}
                    onClick={() => canOpen && setOpenPageUrl(url)}
                    className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-2">{url}</span>
                    <span className="flex shrink-0 items-center gap-3">
                      {score !== null && (
                        <span
                          className="font-mono text-xs font-semibold tabular-nums"
                          style={{ color: scoreBand(score).colorVar }}
                        >
                          {score}
                        </span>
                      )}
                      <span
                        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide"
                        style={{ color: status.colorVar }}
                      >
                        <span aria-hidden="true" className={status.label === "Auditing" ? "wb-skeleton" : ""}>
                          {status.glyph}
                        </span>
                        {status.label}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {stoppedEarly && (
        <div role="status" className="rounded-[var(--radius-lg,5px)] border border-line-strong bg-surface-2 px-3.5 py-3">
          <p className="font-mono text-xs text-text-2">
            Stopped early ({stoppedEarly.reason}) — {stoppedEarly.pagesRemaining} page
            {stoppedEarly.pagesRemaining === 1 ? "" : "s"} not audited. Results below are from the pages that
            finished.
          </p>
        </div>
      )}

      {rollup && (
        <Card label="Site rollup">
          <div className="flex flex-col gap-4 p-3.5">
            {rollup.avgScores && (
              <div className="grid grid-cols-2 gap-2">
                {LENS_ORDER.map((lens) => (
                  <ScoreTile
                    key={lens}
                    code={LENS_META[lens].code}
                    name={LENS_META[lens].name}
                    value={rollup.avgScores![lens]}
                  />
                ))}
              </div>
            )}

            {rollup.worstPages.length > 0 && (
              <div>
                <h3 className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-text-3">
                  Worst pages
                </h3>
                <ul className="flex flex-col gap-1">
                  {rollup.worstPages.map((p) => {
                    const canOpen = pages[p.url]?.phase === "done" || pages[p.url]?.phase === "error";
                    return (
                      <li key={p.url} className="flex items-center justify-between gap-3 font-mono text-xs">
                        <button
                          type="button"
                          disabled={!canOpen}
                          onClick={() => canOpen && setOpenPageUrl(p.url)}
                          className="min-w-0 flex-1 truncate text-left text-text-2 hover:text-accent-ink hover:underline disabled:no-underline disabled:hover:text-text-2"
                        >
                          {p.title || p.url}
                        </button>
                        <span
                          className="shrink-0 font-semibold tabular-nums"
                          style={{ color: scoreBand(p.overallScore).colorVar }}
                        >
                          {p.overallScore}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {rollup.commonFindings.length > 0 && (
              <div>
                <h3 className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-text-3">
                  Common findings
                </h3>
                <ul className="flex flex-col gap-1">
                  {rollup.commonFindings.map((f) => (
                    <li key={f.issue} className="flex items-center justify-between gap-3 font-mono text-xs text-text-2">
                      <span className="min-w-0 flex-1 truncate">{f.issue}</span>
                      <span className="shrink-0 text-text-3">
                        {f.count} pages
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}

      {rollup && rootUrl && <SiteReportActions rootUrl={rootUrl} rollup={rollup} />}
    </div>
  );
}
