"use client";

import { useMemo } from "react";
import type { ScoreBreakdown } from "@aeo/scoring";
import { blendBreakdown } from "@/lib/audit/derive";

export interface LocalRescore {
  /** The breakdown to display: the true one when clean, an estimated blend when dirty. */
  breakdown: ScoreBreakdown | null;
  /** True when the working doc diverges from what produced the true score. */
  isEstimated: boolean;
}

/**
 * Derives the displayed score from the working document. When the content
 * still matches what produced `trueBreakdown`, the true breakdown is shown
 * verbatim. Once the user edits (e.g. accepts a rewrite hunk), the DET half is
 * recomputed locally and re-blended with the last RUB signals — an instant,
 * free "estimated" score. This is pure derivation, not an effect.
 *
 * ponytail: this is the sibling-owned "client re-score hook" seam. It is a
 * real implementation (DET_SIGNALS + LENS_WEIGHTS are exported for exactly
 * this), not a stub — reconcile the import path at integrate if a sibling
 * ships a duplicate.
 */
export function useLocalRescore(
  content: string,
  isHtml: boolean,
  trueBreakdown: ScoreBreakdown | null,
  trueContent: string | null,
): LocalRescore {
  return useMemo(() => {
    if (!trueBreakdown) return { breakdown: null, isEstimated: false };
    if (trueContent !== null && content === trueContent) {
      return { breakdown: trueBreakdown, isEstimated: false };
    }
    return { breakdown: blendBreakdown(content, isHtml, trueBreakdown), isEstimated: true };
  }, [content, isHtml, trueBreakdown, trueContent]);
}
