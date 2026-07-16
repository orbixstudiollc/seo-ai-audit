import type { WorkbenchAudit, WorkbenchDocument } from "../audit/types";
import { buildFaqJsonLd } from "../audit/jsonld";
import { buildOptimizedMarkdown } from "./markdown";
import { buildOptimizedHtml } from "./html";
import { buildRoadmapMarkdown } from "./roadmap";

/**
 * The export bundle — everything a completed audit yields, assembled in one
 * call the UI can feed straight to downloads/clipboard. Every field is a
 * plain string (or null), so the bundle serializes cleanly.
 */

export interface BuildExportBundleInput {
  document: WorkbenchDocument;
  audit: WorkbenchAudit;
  /** Ids of the rewrite hunks the user accepted in the workbench. */
  acceptedRewriteIds: readonly string[];
}

export interface ExportBundle {
  /** The working document with accepted rewrites applied. */
  optimizedMarkdown: string;
  /** Full HTML document: semantic body + embedded JSON-LD script block. */
  optimizedHtml: string;
  /** Pretty-printed FAQ JSON-LD, or null when the audit found no Q/A pairs. */
  jsonLd: string | null;
  /** Priority roadmap checklist (Quick Wins / Strategic / Long-term). */
  roadmapMarkdown: string;
  /** Pretty-printed ScoreBreakdown for a scores.json download. */
  scoresJson: string;
}

export function buildExportBundle({
  document,
  audit,
  acceptedRewriteIds,
}: BuildExportBundleInput): ExportBundle {
  if (!audit.scores) {
    throw new Error("Cannot build export bundle: audit has no scores yet.");
  }

  const acceptedIds = new Set(acceptedRewriteIds);
  const acceptedRewrites = (audit.rewrites?.hunks ?? []).filter((h) => acceptedIds.has(h.id));

  const optimizedMarkdown = buildOptimizedMarkdown({
    rawContent: document.rawContent,
    acceptedRewrites,
  });
  const jsonLd = buildFaqJsonLd(audit.findings?.qaPairs ?? []);

  return {
    optimizedMarkdown,
    optimizedHtml: buildOptimizedHtml(optimizedMarkdown, jsonLd),
    jsonLd,
    roadmapMarkdown: buildRoadmapMarkdown(audit.scores, audit.findings),
    scoresJson: JSON.stringify(audit.scores, null, 2),
  };
}

export { buildOptimizedMarkdown } from "./markdown";
export type { BuildOptimizedMarkdownInput } from "./markdown";
export { buildOptimizedHtml } from "./html";
export { buildRoadmapMarkdown, signalPriority } from "./roadmap";
export type { RoadmapItem } from "./roadmap";
