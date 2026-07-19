"use client";

import { useCallback, useEffect, useState } from "react";
import { cloudFetch } from "@/lib/cloud/request";
import type { TechnicalAuditTask } from "@/lib/dataforseo";
import { Button } from "@/app/components/ui/Button";
import { Card } from "@/app/components/ui/Card";

type Props = {
  auditId: string;
  rootUrl: string;
  limit?: number;
};

const PAGE_SIZE = 25;

function labelIssue(key: string): string {
  return key.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

export function TechnicalSeoPanel({ auditId, rootUrl, limit = 500 }: Props) {
  const [task, setTask] = useState<TechnicalAuditTask | null>(null);
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const response = await cloudFetch(`/api/technical-audit?auditId=${encodeURIComponent(auditId)}`, {
        method: "GET",
      });
      const body = await response.json() as { task?: TechnicalAuditTask; configured?: boolean; error?: string };
      if (response.status === 404) {
        setTask(null);
        setConfigured(body.configured !== false);
        setError(null);
        return;
      }
      if (body.error === "provider_unavailable") setConfigured(false);
      if (!response.ok || !body.task) {
        setError(response.status === 502 ? "The technical crawl could not be refreshed yet." : "Technical audit data is temporarily unavailable.");
        return;
      }
      setConfigured(true);
      setTask(body.task);
      setError(null);
    } catch {
      setError("Technical audit data is temporarily unavailable.");
    } finally {
      setReady(true);
    }
  }, [auditId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load(); });
    return () => { active = false; };
  }, [load]);

  useEffect(() => {
    if (task?.status !== "queued" && task?.status !== "running") return;
    const timeout = window.setTimeout(() => { void load(); }, 5_000);
    return () => window.clearTimeout(timeout);
  }, [load, task?.status, task?.updatedAt]);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const response = await cloudFetch("/api/technical-audit", {
        method: "POST",
        body: JSON.stringify({ auditId, url: rootUrl, limit: Math.max(1, Math.min(500, Math.floor(limit))) }),
      });
      const body = await response.json() as { task?: TechnicalAuditTask; error?: string };
      if (body.error === "provider_unavailable") setConfigured(false);
      if (!response.ok || !body.task) {
        setError(body.error === "audit_not_found"
          ? "Save this site audit to cloud storage before starting the technical crawl."
          : "The technical crawl could not be started.");
        return;
      }
      setTask(body.task); setConfigured(true);
    } catch {
      setError("The technical crawl could not be started.");
    } finally {
      setBusy(false); setReady(true);
    }
  };

  const pages = task?.result?.pages ?? [];
  const pageCount = Math.max(1, Math.ceil(pages.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visiblePages = pages.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <Card
      label="Technical SEO"
      aside={<span className="font-mono text-[10px] uppercase tracking-wider text-text-3">DataForSEO OnPage</span>}
    >
      <div className="flex flex-col gap-4 p-3.5">
        {!ready && <p className="wb-skeleton font-mono text-xs text-text-3">Checking technical crawl…</p>}

        {ready && !task && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="max-w-2xl">
              <p className="text-sm font-medium text-text-1">Run a reusable technical crawl</p>
              <p className="mt-1 text-xs leading-relaxed text-text-3">
                Pull status codes, crawl depth, on-page scores, and technical issue flags for up to {Math.max(1, Math.min(500, Math.floor(limit)))} pages. This is separate from the AI audit and is charged once by DataForSEO.
              </p>
            </div>
            <Button size="sm" onClick={() => void start()} disabled={busy || !configured}>
              {busy ? "Starting…" : "Run technical crawl"}
            </Button>
          </div>
        )}

        {!configured && (
          <p role="status" className="text-xs text-text-3">
            DataForSEO credentials are not configured on the server yet.
          </p>
        )}

        {task && (task.status === "queued" || task.status === "running") && (
          <div role="status" className="rounded-[var(--radius-lg,5px)] border border-line-strong bg-surface-2 p-3">
            <p className="font-mono text-xs uppercase tracking-wider text-accent-ink">Crawl in progress</p>
            <p className="mt-1 text-xs text-text-3">
              {task.result ? `${task.result.pagesCrawled} pages crawled · ${task.result.pagesInQueue} queued` : "Waiting for DataForSEO to begin crawling."}
            </p>
          </div>
        )}

        {task?.status === "complete" && task.result && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["On-page score", task.result.onpageScore === null ? "—" : Math.round(task.result.onpageScore)],
                ["Pages crawled", task.result.pagesCrawled],
                ["Pages returned", pages.length],
                ["Provider cost", task.costUsd === null ? "—" : `$${task.costUsd.toFixed(4)}`],
              ].map(([label, value]) => (
                <div key={String(label)} className="border border-line bg-surface-2 p-2.5">
                  <p className="font-mono text-[9px] uppercase tracking-wider text-text-3">{label}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-text-1">{value}</p>
                </div>
              ))}
            </div>

            {pages.length > 0 && (
              <div className="overflow-hidden rounded-[var(--radius-lg,5px)] border border-line">
                <ul className="divide-y divide-line">
                  {visiblePages.map((item) => (
                    <li key={item.url} className="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <a href={item.url} target="_blank" rel="noreferrer" className="block truncate font-mono text-xs text-text-2 hover:text-accent-ink hover:underline">
                          {item.title || item.url}
                        </a>
                        <p className="truncate font-mono text-[10px] text-text-3">{item.url}</p>
                        {item.issueKeys.length > 0 && <p className="mt-1 text-[10px] text-text-3">{item.issueKeys.slice(0, 3).map(labelIssue).join(" · ")}{item.issueKeys.length > 3 ? ` · +${item.issueKeys.length - 3}` : ""}</p>}
                      </div>
                      <div className="flex shrink-0 gap-3 font-mono text-[10px] uppercase tracking-wide text-text-3">
                        <span>HTTP {item.statusCode ?? "—"}</span>
                        <span>Score {item.onpageScore === null ? "—" : Math.round(item.onpageScore)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                {pageCount > 1 && (
                  <div className="flex items-center justify-between border-t border-line bg-surface-2 px-3 py-2">
                    <Button size="sm" variant="ghost" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-text-3">Page {currentPage} of {pageCount}</span>
                    <Button size="sm" variant="ghost" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {task?.status === "failed" && <p role="alert" className="text-xs text-score-weak">{task.errorMessage ?? "The technical crawl failed."}</p>}
        {error && <p role="alert" className="text-xs text-score-weak">{error}</p>}
      </div>
    </Card>
  );
}
