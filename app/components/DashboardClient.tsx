"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LENS_META, LENS_ORDER } from "@/lib/audit/signalMeta";
import { scoreBand } from "@/lib/audit/scoreScale";
import { useLocalSettings } from "@/app/hooks/useLocalSettings";
import { HISTORY_CHANGED_EVENT, HISTORY_KEY, filterAndSortHistory, loadHistory, removeHistoryRecord, storeHistory, type AuditHistoryRecord } from "@/lib/history";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

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
  function clearAll() { if (settings.confirmBeforeClear && !window.confirm("Clear all audit history from this browser?")) return; window.localStorage.removeItem(HISTORY_KEY); setRecords([]); window.dispatchEvent(new Event(HISTORY_CHANGED_EVENT)); }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="font-mono text-xs uppercase tracking-[0.16em] text-text-3">Local workspace</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Audit dashboard</h1><p className="mt-2 max-w-xl text-sm text-text-2">Your recent blog and site audits, stored only in this browser.</p></div><Link href="/" className="inline-flex h-9 items-center bg-text-1 px-4 font-mono text-xs font-medium uppercase tracking-wider text-surface-1 hover:bg-accent-ink">New audit</Link></div>

      <Card label={`History (${records.length})`} aside={records.length > 0 ? <Button size="sm" variant="ghost" onClick={clearAll}>Clear history</Button> : undefined}>
        {records.length > 0 && <div className="grid gap-3 border-b border-line p-3 sm:grid-cols-3"><label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wider text-text-3">Search<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title or domain" className="h-9 border border-line-strong bg-surface-1 px-3 font-sans text-sm normal-case tracking-normal text-text-1" /></label><label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wider text-text-3">Type<select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="h-9 border border-line-strong bg-surface-1 px-3 font-sans text-sm normal-case tracking-normal text-text-1"><option value="all">All</option><option value="single">Single page</option><option value="site">Whole site</option></select></label><label className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-wider text-text-3">Sort<select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-9 border border-line-strong bg-surface-1 px-3 font-sans text-sm normal-case tracking-normal text-text-1"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="highest">Highest score</option><option value="lowest">Lowest score</option></select></label></div>}
        {!ready ? <p className="wb-skeleton p-6 text-sm text-text-3">Loading local history…</p> : records.length === 0 ? <div className="p-8 text-center"><h2 className="font-semibold">No audits saved yet</h2><p className="mt-2 text-sm text-text-2">Run your first audit and it will appear here automatically.</p><Link href="/" className="mt-4 inline-block font-mono text-xs uppercase tracking-wider text-accent-ink hover:underline">Start an audit →</Link></div> : visible.length === 0 ? <p className="p-8 text-center text-sm text-text-2">No audits match these filters.</p> : <ul className="divide-y divide-line">{visible.map((record) => { const rerun = record.mode === "site" ? `/audit/site?url=${encodeURIComponent(record.url)}` : `/audit?url=${encodeURIComponent(record.url)}`; let domain = record.url; try { domain = new URL(record.url).hostname; } catch {} return <li key={record.id} className="p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-medium">{record.title || domain}</h2><span className="border border-line-strong px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-3">{record.mode === "site" ? "Whole site" : "Single page"}</span><span className="font-mono text-[10px] uppercase text-text-3">{record.status}</span></div><p className="mt-1 truncate font-mono text-xs text-text-2">{domain} · {new Date(record.createdAt).toLocaleString()}{record.pageCount !== undefined ? ` · ${record.pageCount} pages` : ""}</p></div>{record.scores && <div className="grid grid-cols-4 gap-2">{LENS_ORDER.map((lens) => <div key={lens} className="min-w-14 border border-line bg-surface-2 px-2 py-1 text-center"><span className="block font-mono text-[8px] uppercase text-text-3">{LENS_META[lens].code}</span><strong className="font-mono text-sm" style={{ color: scoreBand(record.scores![lens]).colorVar }}>{record.scores![lens]}</strong></div>)}</div>}<div className="flex shrink-0 flex-wrap gap-3 font-mono text-[10px] uppercase tracking-wider"><Link href={rerun} className="text-accent-ink hover:underline">Run again</Link><a href={record.url} target="_blank" rel="noreferrer" className="text-text-2 hover:underline">Open URL</a><button type="button" onClick={() => persist(removeHistoryRecord(records, record.id))} className="text-score-weak hover:underline">Remove</button></div></div></li>; })}</ul>}
      </Card>
      <p className="text-center text-xs text-text-3">History stays on this device. Clearing browser data removes it; account synchronization is not enabled.</p>
    </main>
  );
}
