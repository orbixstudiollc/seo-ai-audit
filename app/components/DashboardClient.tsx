"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LENS_META, LENS_ORDER, SIGNAL_META } from "@/lib/audit/signalMeta";
import { scoreBand } from "@/lib/audit/scoreScale";
import { useLocalSettings } from "@/app/hooks/useLocalSettings";
import {
  HISTORY_CHANGED_EVENT,
  HISTORY_KEY,
  LEGACY_HISTORY_KEY,
  LEGACY_HISTORY_V1_KEY,
  averageScore,
  filterAndSortHistory,
  loadHistory,
  removeHistoryRecord,
  storeHistory,
  type AuditHistoryRecord,
  type AuditHistoryStatus,
} from "@/lib/history";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

const STATUS_STYLE: Record<AuditHistoryStatus, { label: string; glyph: string; color: string; tint: string }> = {
  started: { label: "Started", glyph: "●", color: "var(--accent-ink)", tint: "var(--accent-tint)" },
  complete: { label: "Complete", glyph: "✓", color: "var(--score-strong)", tint: "var(--score-strong-tint)" },
  partial: { label: "Partial", glyph: "◐", color: "var(--score-mid)", tint: "var(--score-mid-tint)" },
  failed: { label: "Failed", glyph: "✕", color: "var(--score-weak)", tint: "var(--score-weak-tint)" },
};

function DetailList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h4 className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-text-3">{title}</h4>
      <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-text-2">
        {items.map((item, index) => <li key={`${title}-${index}`} className="border-l-2 border-line-strong pl-2.5">{item}</li>)}
      </ul>
    </section>
  );
}

function AuditDetails({ record, rerun }: { record: AuditHistoryRecord; rerun: string }) {
  const details = record.details;
  return (
    <details className="group border-t border-line bg-surface-2">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ink">
        <span>View details</span><span aria-hidden="true" className="transition-transform group-open:rotate-180">↓</span>
      </summary>
      <div className="border-t border-line px-4 py-4">
        <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="font-mono text-[9px] uppercase tracking-wider text-text-3">Submitted URL</dt><dd className="mt-1 break-all text-text-2">{record.url}</dd></div>
          <div><dt className="font-mono text-[9px] uppercase tracking-wider text-text-3">Started</dt><dd className="mt-1 text-text-2">{new Date(record.createdAt).toLocaleString()}</dd></div>
          <div><dt className="font-mono text-[9px] uppercase tracking-wider text-text-3">Status</dt><dd className="mt-1 capitalize text-text-2">{record.status}</dd></div>
          <div><dt className="font-mono text-[9px] uppercase tracking-wider text-text-3">Scope</dt><dd className="mt-1 text-text-2">{record.mode === "site" ? `${record.pageCount ?? 0} pages audited` : details?.kind === "single" && details.wordCount !== undefined ? `${details.wordCount.toLocaleString()} words` : "Single page"}</dd></div>
        </dl>

        {!details ? (
          <div className="mt-4 border border-line-strong bg-surface-1 p-3 text-xs text-text-2">
            This older audit has no saved detail snapshot. <Link href={rerun} className="font-medium text-accent-ink hover:underline">Run it again</Link> to create one.
          </div>
        ) : details.kind === "single" ? (
          <div className="mt-5 space-y-5">
            {details.errorMessage && <p role="note" className="border border-score-weak bg-[var(--score-weak-tint)] p-3 text-xs text-score-weak">{details.errorMessage}</p>}
            {details.weakestSignals.length > 0 && <section><h4 className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-text-3">Weakest signals</h4><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{details.weakestSignals.map((signal) => <div key={signal.id} className="border border-line bg-surface-1 p-2.5"><span className="font-mono text-[9px] text-text-3">{signal.id}</span><strong className="ml-2 font-mono text-sm" style={{ color: scoreBand(signal.score).colorVar }}>{signal.score}</strong><p className="mt-1 text-[11px] leading-snug text-text-2">{SIGNAL_META[signal.id].label}</p></div>)}</div></section>}
            <div className="grid gap-5 md:grid-cols-3"><DetailList title="Blockers" items={details.blockers} /><DetailList title="Question gaps" items={details.questionGaps} /><DetailList title="Citation claims" items={details.citationClaims} /></div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-text-3">Suggested rewrites saved: {details.rewriteCount}</p>
          </div>
        ) : (
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            {details.errorMessage && <p role="note" className="border border-score-weak bg-[var(--score-weak-tint)] p-3 text-xs text-score-weak md:col-span-2">{details.errorMessage}</p>}
            <DetailList title="Lowest-scoring pages" items={details.worstPages.map((page) => `${page.overallScore}/100 — ${page.title || page.url}`)} />
            <DetailList title="Common findings" items={details.commonFindings.map((finding) => `${finding.issue} — ${finding.count} pages`)} />
            <p className="font-mono text-[10px] uppercase tracking-wider text-text-3 md:col-span-2">Pages failed: {details.pagesFailed}</p>
          </div>
        )}
      </div>
    </details>
  );
}

function AuditHistoryCard({ record, onRemove }: { record: AuditHistoryRecord; onRemove: () => void }) {
  const rerun = record.mode === "site" ? `/audit/site?url=${encodeURIComponent(record.url)}` : `/audit?url=${encodeURIComponent(record.url)}`;
  const status = STATUS_STYLE[record.status];
  const overall = averageScore(record);
  let domain = record.url;
  try { domain = new URL(record.url).hostname; } catch {}

  return (
    <li className="overflow-hidden rounded-[var(--radius-lg,5px)] border border-line-strong bg-surface-1 shadow-[0_1px_0_rgba(0,0,0,0.03)]">
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-wider" style={{ color: status.color, backgroundColor: status.tint }}><span aria-hidden="true">{status.glyph}</span>{status.label}</span>
            <span className="border border-line-strong px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-3">{record.mode === "site" ? "Whole site" : "Single page"}</span>
          </div>
          <h2 className="mt-3 truncate text-lg font-semibold tracking-tight">{record.title || domain}</h2>
          <p className="mt-1 truncate font-mono text-[11px] text-text-3">{domain} · {new Date(record.createdAt).toLocaleString()}{record.pageCount !== undefined ? ` · ${record.pageCount} pages` : ""}</p>
        </div>
        <div className="flex items-center gap-3">
          {overall !== null && <div className="min-w-20 border border-line bg-surface-2 px-3 py-2 text-center"><span className="block font-mono text-[8px] uppercase tracking-wider text-text-3">Average</span><strong className="font-mono text-xl tabular-nums" style={{ color: scoreBand(overall).colorVar }}>{overall}</strong></div>}
          <div className="flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-wider"><Link href={rerun} className="text-accent-ink hover:underline">Run again</Link><a href={record.url} target="_blank" rel="noreferrer" className="text-text-2 hover:underline">Open URL</a><button type="button" onClick={onRemove} className="text-score-weak hover:underline">Remove</button></div>
        </div>
      </div>
      {record.scores && <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">{LENS_ORDER.map((lens) => <div key={lens} className="flex items-center justify-between bg-surface-2 px-3 py-2"><span className="font-mono text-[9px] uppercase tracking-wider text-text-3">{LENS_META[lens].code}</span><strong className="font-mono text-base tabular-nums" style={{ color: scoreBand(record.scores![lens]).colorVar }}>{record.scores![lens]}</strong></div>)}</div>}
      <AuditDetails record={record} rerun={rerun} />
    </li>
  );
}

export function DashboardClient() {
  const [records, setRecords] = useState<AuditHistoryRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"all" | "single" | "site">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "highest" | "lowest">("newest");
  const { settings } = useLocalSettings();

  useEffect(() => {
    const sync = () => { setRecords(loadHistory(window.localStorage)); setReady(true); };
    sync(); window.addEventListener(HISTORY_CHANGED_EVENT, sync); window.addEventListener("storage", sync);
    return () => { window.removeEventListener(HISTORY_CHANGED_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);

  const visible = useMemo(() => filterAndSortHistory(records, { query, mode, sort }), [records, query, mode, sort]);
  function persist(next: AuditHistoryRecord[]) { storeHistory(window.localStorage, next); setRecords(next); window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT)); }
  function clearAll() {
    if (settings.confirmBeforeClear && !window.confirm("Clear all audit history from this browser?")) return;
    for (const key of [HISTORY_KEY, LEGACY_HISTORY_KEY, LEGACY_HISTORY_V1_KEY]) window.localStorage.removeItem(key);
    setRecords([]); window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT));
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="font-mono text-xs uppercase tracking-[0.16em] text-text-3">Local workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Audit dashboard</h1><p className="mt-2 max-w-xl text-sm text-text-2">Every audit query you run, with a compact review snapshot stored only in this browser.</p></div><Link href="/" className="inline-flex h-9 items-center bg-text-1 px-4 font-mono text-xs font-medium uppercase tracking-wider text-surface-1 hover:bg-accent-ink">New audit</Link></div>

      <Card label={`History (${records.length})`} aside={records.length > 0 ? <Button size="sm" variant="ghost" onClick={clearAll}>Clear history</Button> : undefined} bodyClassName="bg-surface-2">
        {records.length > 0 && <div className="grid gap-3 border-b border-line bg-surface-1 p-3 sm:grid-cols-3"><label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wider text-text-3">Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title or domain" className="h-9 border border-line-strong bg-surface-1 px-3 font-sans text-sm normal-case tracking-normal text-text-1" /></label><label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wider text-text-3">Type<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} className="h-9 border border-line-strong bg-surface-1 px-3 font-sans text-sm normal-case tracking-normal text-text-1"><option value="all">All</option><option value="single">Single page</option><option value="site">Whole site</option></select></label><label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wider text-text-3">Sort<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="h-9 border border-line-strong bg-surface-1 px-3 font-sans text-sm normal-case tracking-normal text-text-1"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="highest">Highest score</option><option value="lowest">Lowest score</option></select></label></div>}
        {!ready ? <p className="wb-skeleton p-6 text-sm text-text-3">Loading local history…</p> : records.length === 0 ? <div className="bg-surface-1 p-8 text-center"><h2 className="font-semibold">No audits saved yet</h2><p className="mt-2 text-sm text-text-2">Run your first audit and it will appear here automatically.</p><Link href="/" className="mt-4 inline-block font-mono text-xs uppercase tracking-wider text-accent-ink hover:underline">Start an audit →</Link></div> : visible.length === 0 ? <p className="bg-surface-1 p-8 text-center text-sm text-text-2">No audits match these filters.</p> : <ul className="grid gap-4 p-3 sm:p-4">{visible.map((record) => <AuditHistoryCard key={record.id} record={record} onRemove={() => persist(removeHistoryRecord(records, record.id))} />)}</ul>}
      </Card>
      <p className="text-center text-xs text-text-3">History stays on this device. Clearing browser data removes it; account synchronization is not enabled.</p>
    </main>
  );
}
