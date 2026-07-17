import {
  DET_SIGNAL_IDS,
  DET_SIGNALS,
  runAudit,
  type DetSignalId,
  type DetSignalResult,
  type ParsedDocument,
} from "@aeo/scoring";
import { extractArticle, fetchArticle, ImportError } from "@/lib/import";
import { capAuditContent } from "./contentCap";
import { extractQaPairs, generateRewrites } from "./generator";
import { mapImportError, mapLlmError } from "./errors";
import { buildServerModel } from "./provider";
import type { AuditFindings, AuditStreamEvent } from "./types";

/**
 * The one-URL audit pipeline: SSRF-guarded fetch -> Readability extraction ->
 * @aeo/scoring DET signals -> rubric LLM call -> rewrite LLM call, emitting
 * the exact meta -> signals -> scores -> rewrites -> done/error sequence
 * DATA-CONTRACT §2 defines. Extracted from app/api/audit/route.ts (WS4) so
 * the bulk site-crawl route can reuse it verbatim per page instead of
 * reimplementing it — both routes now call this one function; there is no
 * second copy of the pipeline to drift out of sync.
 */

export type PageAuditWrite = (event: AuditStreamEvent) => void;

export interface RunPageAuditOptions {
  fetchTimeoutMs: number;
  signal: AbortSignal;
}

function computeDetSignals(doc: ParsedDocument): Record<DetSignalId, DetSignalResult> {
  return Object.fromEntries(
    DET_SIGNAL_IDS.map((id) => [id, DET_SIGNALS[id](doc)]),
  ) as Record<DetSignalId, DetSignalResult>;
}

type StreamError = Extract<AuditStreamEvent, { type: "error" }>;

function toImportStreamError(err: unknown): StreamError {
  if (err instanceof ImportError) {
    const mapped = mapImportError(err);
    return { type: "error", kind: mapped.kind, message: mapped.message };
  }
  return {
    type: "error",
    kind: "server",
    message: "Something went wrong reading this page. Try again.",
  };
}

function toLlmStreamError(err: unknown): StreamError {
  const mapped = mapLlmError(err);
  return {
    type: "error",
    kind: mapped.kind,
    message: mapped.userMessage,
    ...(mapped.retryAfterSec !== undefined ? { retryAfter: mapped.retryAfterSec } : {}),
  };
}

/** Log-safe failure record: domain + error kind only — never the URL, page content, or raw error. */
function logFailure(stage: string, host: string, kind: string): void {
  console.error(`[audit] ${stage} failed`, { host, kind });
}

/**
 * Runs the full pipeline for one URL, calling `write` with each stream event
 * in contract order. Every failure path writes a terminal `error` event and
 * returns (never throws) — callers (single-page route, bulk-audit queue)
 * decide what "an audit ended in error" means for their own control flow.
 */
export async function runPageAudit(
  submittedUrl: string,
  targetUrl: URL,
  write: PageAuditWrite,
  opts: RunPageAuditOptions,
): Promise<void> {
  const { fetchTimeoutMs, signal } = opts;

  let fetched: Awaited<ReturnType<typeof fetchArticle>>;
  try {
    fetched = await fetchArticle(targetUrl.toString(), { timeoutMs: fetchTimeoutMs, signal });
  } catch (err) {
    if (err instanceof ImportError) logFailure("fetch", targetUrl.hostname, err.kind);
    write(toImportStreamError(err));
    return;
  }

  let article: ReturnType<typeof extractArticle>;
  try {
    article = extractArticle(fetched.html, fetched.finalUrl);
  } catch (err) {
    if (err instanceof ImportError) logFailure("extract", targetUrl.hostname, err.kind);
    write(toImportStreamError(err));
    return;
  }

  if (signal.aborted) return; // client is gone — skip the LLM spend entirely.

  write({
    type: "meta",
    page: {
      url: submittedUrl,
      finalUrl: fetched.finalUrl,
      title: article.title || fetched.title,
      wordCount: article.wordCount,
      fetchedAt: new Date().toISOString(),
    },
  });

  const capped = capAuditContent(article.contentHtml);
  write({ type: "signals", signals: computeDetSignals(capped.doc) });

  let auditResult: Awaited<ReturnType<typeof runAudit>>;
  try {
    auditResult = await runAudit({
      content: capped.content,
      isHtml: capped.isHtml,
      model: buildServerModel("cheap"),
    });
  } catch (err) {
    logFailure("rubric-call", targetUrl.hostname, mapLlmError(err).kind);
    write(toLlmStreamError(err));
    return;
  }

  if (signal.aborted) return;

  const { yields, ...scoreBreakdown } = auditResult;
  const findings: AuditFindings = {
    questionGaps: yields.questionGaps,
    anchorSuggestions: yields.anchorSuggestions,
    blockers: yields.blockers,
    qaPairs: extractQaPairs(capped.doc),
    quotables: [],
  };
  write({ type: "scores", scores: scoreBreakdown, findings });

  try {
    const rewrites = await generateRewrites({
      doc: capped.doc,
      scoreBreakdown,
      model: buildServerModel("strong"),
      abortSignal: signal,
    });
    write({ type: "rewrites", rewrites });
    write({ type: "done" });
  } catch (err) {
    logFailure("rewrite-call", targetUrl.hostname, mapLlmError(err).kind);
    write(toLlmStreamError(err));
  }
}
