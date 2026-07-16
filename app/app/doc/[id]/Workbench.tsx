"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  LENSES,
  LENS_WEIGHTS,
  type Lens,
  type RubSignalResult,
  type ScoreBreakdown,
  type SignalId,
} from "@aeo/scoring";
import type { RewriteHunk, WorkbenchAudit, WorkbenchDocument } from "@/lib/audit/types";
import { buildFindingItems, carryHunkStatuses, type FindingItem } from "@/lib/audit/derive";
import { formatAuditCostEstimate } from "@/lib/audit/cost";
import { buildFaqJsonLd } from "@/lib/audit/jsonld";
import { isRubResult } from "@/lib/audit/signalMeta";
import {
  getAuditProviderServerSnapshot,
  getAuditProviderSnapshot,
  isProvider,
  readAuditProvider,
  subscribeAuditProvider,
} from "@/lib/keys/preference";
import { deleteDocument, updateDocument } from "@/app/actions/documents";
import { useAuditStream } from "@/app/hooks/useAuditStream";
import { useLocalRescore } from "@/app/hooks/useLocalRescore";
import type { HunkStatus } from "@/app/components/ui/DiffHunk";
import { ExportMenu } from "@/app/components/workbench/ExportMenu";
import { ScoreRail } from "@/app/components/workbench/ScoreRail";
import { WorkPanel, type WorkTab } from "@/app/components/workbench/WorkPanel";
import { EditorPane } from "@/app/components/workbench/EditorPane";

type Props = {
  document: WorkbenchDocument;
  initialAudit: WorkbenchAudit | null;
};

function countWords(text: string): number {
  return text.trim().match(/\S+/g)?.length ?? 0;
}

/** The lens a signal most strongly drives — used to jump from a weak-signal finding to its breakdown. */
function primaryLensFor(signalId: SignalId): Lens {
  let best: Lens = LENSES[0];
  let bestWeight = -1;
  for (const lens of LENSES) {
    const weight = LENS_WEIGHTS[lens][signalId] ?? 0;
    if (weight > bestWeight) {
      bestWeight = weight;
      best = lens;
    }
  }
  return best;
}

function eeatFrom(breakdown: ScoreBreakdown | null): RubSignalResult | null {
  if (!breakdown) return null;
  const result = breakdown.signals.S17;
  return isRubResult(result) ? result : null;
}

export function Workbench({ document, initialAudit }: Props) {
  const seeded = initialAudit?.status === "completed" ? initialAudit : null;
  const router = useRouter();

  const [content, setContent] = useState(document.rawContent);
  // Captured once: the stored content at load, which is what `initialAudit`
  // (the seeded scores) audited. The prop itself can refresh after a save.
  const [initialContent] = useState(document.rawContent);
  // What the documents table currently holds — the target of the unsaved-edits
  // badge and the Save affordance.
  const [savedContent, setSavedContent] = useState(document.rawContent);
  // The content the most recently STARTED audit scored, so streamed-in scores
  // pair with the right text (handleRun persists before auditing).
  const [auditedContent, setAuditedContent] = useState(document.rawContent);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hunkStatuses, setHunkStatuses] = useState<Record<string, HunkStatus>>({});
  const [tab, setTab] = useState<WorkTab>("findings");
  const [openLens, setOpenLens] = useState<Lens | null>(null);

  const stream = useAuditStream();

  // The server-confirmed audit state is DERIVED, never mirrored into local
  // state: the stream hook already holds the latest streamed phases durably,
  // and `seeded` holds the initial audit. Deriving keeps a single source of
  // truth and avoids setState-in-effect.
  const trueBreakdown = stream.scores ?? seeded?.scores ?? null;
  const findings = stream.findings ?? seeded?.findings ?? null;
  const rewrites = stream.rewrites ?? seeded?.rewrites ?? null;
  const modelId = stream.scores?.modelId ?? seeded?.modelId ?? null;
  // The content behind the true score: streamed scores pair with the content
  // handleRun persisted-then-audited; seeded scores pair with the content the
  // page loaded with. Unsaved editor edits are the "estimated" delta on top.
  const trueContent = stream.scores ? auditedContent : seeded ? initialContent : null;

  // Hunk ids repeat across audits ("intro", "section-0", ... — see
  // lib/audit/generator.ts), so accept/reject statuses are only valid for the
  // exact rewrites payload they were set against. Reset during render (React's
  // adjust-state-on-prop-change pattern) so a new audit's hunks never paint
  // pre-accepted — and never leak into acceptedRewriteIds/export.
  const [statusesRewrites, setStatusesRewrites] = useState(rewrites);
  if (statusesRewrites !== rewrites) {
    setStatusesRewrites(rewrites);
    setHunkStatuses((prev) => carryHunkStatuses(prev, statusesRewrites, rewrites));
  }

  // Must match how the server parses this document (see app/api/audit/route.ts
  // and app/actions/documents.ts) — a hardcoded false here would parse
  // URL-imported HTML as markdown and produce a bogus estimated score.
  const { breakdown, isEstimated } = useLocalRescore(
    content,
    document.source === "url",
    trueBreakdown,
    trueContent,
  );

  const findingItems = useMemo(() => buildFindingItems(breakdown, findings), [breakdown, findings]);
  const schemaJson = useMemo(() => buildFaqJsonLd(findings?.qaPairs ?? []), [findings]);
  const eeatResult = eeatFrom(breakdown);

  // Provider preference (localStorage, shared with settings) drives the
  // pre-run cost estimate next to Run/Re-score. Null (unset / SSR) → range.
  const storedProvider = useSyncExternalStore(
    subscribeAuditProvider,
    getAuditProviderSnapshot,
    getAuditProviderServerSnapshot,
  );
  const costEstimate = formatAuditCostEstimate(
    countWords(content),
    isProvider(storedProvider) ? storedProvider : null,
  );

  const acceptedRewriteIds = useMemo(
    () => Object.keys(hunkStatuses).filter((id) => hunkStatuses[id] === "accepted"),
    [hunkStatuses],
  );

  // The latest audit as the export pipeline sees it: streamed phases overlay
  // the seeded row, so exports always carry the freshest confirmed scores.
  // With no completed audit yet, scores stay null and ExportMenu disables.
  const exportAudit = useMemo<WorkbenchAudit>(
    () => ({
      id: stream.auditId ?? seeded?.id ?? document.id,
      status: "completed",
      scoresStatus: trueBreakdown ? "done" : "pending",
      rewritesStatus: rewrites ? "done" : "pending",
      scores: trueBreakdown,
      findings,
      rewrites,
      modelId: modelId ?? "",
      createdAt: seeded?.createdAt ?? "",
    }),
    [stream.auditId, seeded, document.id, trueBreakdown, findings, rewrites, modelId],
  );

  /** Persist the working doc via the updateDocument server action. Returns false on failure. */
  const persistWorkingDoc = useCallback(async (): Promise<boolean> => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateDocument(document.id, { rawContent: content });
      setSavedContent(content);
      return true;
    } catch {
      setSaveError("Could not save your edits. Try again.");
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [content, document.id]);

  const handleSave = useCallback(() => {
    void persistWorkingDoc();
  }, [persistWorkingDoc]);

  const handleRun = useCallback(() => {
    if (isSaving) return;
    setOpenLens(null);
    void (async () => {
      // Persist edits BEFORE auditing: the server always audits the STORED
      // document, so an unsaved working doc would content_hash cache-hit and
      // serve back the old scores. Saving first busts the cache, making this a
      // true re-score of what's on screen.
      if (content !== savedContent && !(await persistWorkingDoc())) return;
      setAuditedContent(content);
      // The provider preference rides along best-effort; the server validates it
      // against the user's stored keys and falls back to a default (or errors with
      // a "no key" message deep-linking to Settings).
      stream.start({ documentId: document.id, provider: readAuditProvider() ?? undefined });
    })();
  }, [content, savedContent, isSaving, persistWorkingDoc, document.id, stream]);

  const handleDelete = useCallback(() => {
    if (!window.confirm(`Delete "${document.title}" and its audits? This cannot be undone.`)) return;
    void deleteDocument(document.id)
      .then(() => router.push("/app"))
      .catch(() => setSaveError("Could not delete the document. Try again."));
  }, [document.id, document.title, router]);

  // --- Resume: pick up a still-running audit instead of dead-ending ---------
  const latestRunningId = initialAudit?.status === "running" ? initialAudit.id : null;
  const resumedAuditIdRef = useRef<string | null>(null);
  const resumeAudit = stream.resume;
  const streamErrorKind = stream.error?.kind ?? null;

  // An audit can already be in flight two ways: the page loaded while a
  // `running` row existed (phase "idle"), or POST /api/audit bounced with a
  // 409 already_running (phase "error"). Either way, resume the running row's
  // persisted phases rather than dead-ending. When the 409 arrives before the
  // row is in our server props, refresh them so this effect re-runs with the
  // id once it surfaces.
  const canResume = stream.phase === "idle" || streamErrorKind === "already_running";
  useEffect(() => {
    if (!canResume) return;
    if (!latestRunningId) {
      if (streamErrorKind === "already_running") router.refresh();
      return;
    }
    // A 409 re-resumes even an id already resumed once (the running row is
    // authoritative); the ref only dedupes the on-load/refresh path.
    if (streamErrorKind !== "already_running" && resumedAuditIdRef.current === latestRunningId) {
      return;
    }
    resumedAuditIdRef.current = latestRunningId;
    resumeAudit(latestRunningId);
  }, [canResume, streamErrorKind, latestRunningId, resumeAudit, router]);

  const handleAccept = useCallback((hunk: RewriteHunk) => {
    setContent((prev) => (prev.includes(hunk.before) ? prev.replace(hunk.before, hunk.after) : prev));
    setHunkStatuses((prev) => ({ ...prev, [hunk.id]: "accepted" }));
  }, []);

  const handleReject = useCallback((hunk: RewriteHunk) => {
    setHunkStatuses((prev) => ({ ...prev, [hunk.id]: "rejected" }));
  }, []);

  const handleReset = useCallback(
    (hunk: RewriteHunk) => {
      // Only revert the working-doc text if this hunk had actually been applied;
      // rejecting never touched the content. Read status outside the updater so
      // no side effect runs inside setState (StrictMode double-invokes updaters).
      if (hunkStatuses[hunk.id] === "accepted") {
        setContent((c) => (c.includes(hunk.after) ? c.replace(hunk.after, hunk.before) : c));
      }
      setHunkStatuses((prev) => ({ ...prev, [hunk.id]: "pending" }));
    },
    [hunkStatuses],
  );

  const handleActivateFinding = useCallback((item: FindingItem) => {
    if (item.signalId) setOpenLens(primaryLensFor(item.signalId));
  }, []);

  const isDirty = content !== savedContent;

  return (
    <div className="workbench flex min-h-full flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line px-4 py-2.5 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/app"
            className="font-mono text-[11px] uppercase tracking-wider text-text-3 hover:text-text-1"
          >
            ← Docs
          </Link>
          <span className="h-4 w-px bg-line" aria-hidden="true" />
          <h1 className="min-w-0 truncate text-sm font-semibold text-text-1">{document.title}</h1>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-text-3">
          <span className="rounded-sm border border-line px-1.5 py-0.5">{document.source}</span>
          <span>{countWords(content).toLocaleString()} words</span>
          <ExportMenu
            document={document}
            audit={exportAudit}
            acceptedRewriteIds={acceptedRewriteIds}
            workingContent={content}
          />
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-sm border border-transparent px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-3 transition-colors hover:border-line hover:text-[var(--score-weak)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-ink"
          >
            Delete
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 md:p-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
        <div className="flex min-h-[24rem] min-w-0 flex-col lg:min-h-0">
          <EditorPane
            content={content}
            onChange={setContent}
            wordCount={countWords(content)}
            isDirty={isDirty}
            isSaving={isSaving}
            saveError={saveError}
            onSave={handleSave}
          />
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <ScoreRail
            breakdown={breakdown}
            isEstimated={isEstimated}
            eeatResult={eeatResult}
            openLens={openLens}
            onOpenLens={(lens) => setOpenLens((cur) => (cur === lens ? null : lens))}
            phase={stream.phase}
            hasScores={stream.scores !== null}
            hasRewrites={stream.rewrites !== null}
            hasAudit={trueBreakdown !== null}
            modelId={modelId}
            error={stream.error?.message ?? null}
            errorKind={streamErrorKind}
            costEstimate={costEstimate}
            onRun={handleRun}
            onCancel={stream.cancel}
          />

          <WorkPanel
            tab={tab}
            onTab={setTab}
            openLens={openLens}
            onCloseLens={() => setOpenLens(null)}
            breakdown={breakdown}
            findingItems={findingItems}
            findingCount={findingItems.length}
            rewriteCount={rewrites?.hunks.length ?? 0}
            onActivateFinding={handleActivateFinding}
            rewrites={rewrites}
            hunkStatuses={hunkStatuses}
            onAccept={handleAccept}
            onReject={handleReject}
            onReset={handleReset}
            schemaJson={schemaJson}
          />
        </div>
      </main>
    </div>
  );
}
