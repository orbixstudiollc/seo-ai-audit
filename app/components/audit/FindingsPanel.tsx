"use client";

import type { ScoreBreakdown } from "@aeo/scoring";
import type { AuditFindings } from "@/lib/audit/types";
import { buildFindingItems, type FindingItem } from "@/lib/audit/derive";
import { Card } from "@/app/components/ui/Card";
import { FindingsDrawer } from "@/app/components/workbench/FindingsDrawer";

type Props = {
  breakdown: ScoreBreakdown | null;
  findings: AuditFindings | null;
  onActivateFinding: (item: FindingItem) => void;
};

function EmptySection({ children }: { children: string }) {
  return <p className="px-4 py-3 text-center text-[12px] text-text-3">{children}</p>;
}

/**
 * Everything AuditFindings carries: blockers/question-gaps/weak-signals go
 * through the existing severity-chipped FindingsDrawer (via buildFindingItems,
 * unchanged since AuditFindings' shape is unchanged in v1); anchor
 * suggestions, quotables, and Q&A pairs — none of which have a severity — get
 * their own plain sections below.
 */
export function FindingsPanel({ breakdown, findings, onActivateFinding }: Props) {
  const items = buildFindingItems(breakdown, findings);
  const anchors = findings?.anchorSuggestions ?? [];
  const quotables = findings?.quotables ?? [];
  const qaPairs = findings?.qaPairs ?? [];

  return (
    <Card label="Findings" className="min-h-0" bodyClassName="flex flex-col divide-y divide-line">
      <FindingsDrawer items={items} onActivate={onActivateFinding} />

      <section aria-labelledby="anchor-suggestions-heading">
        <h3
          id="anchor-suggestions-heading"
          className="px-4 pt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-text-3"
        >
          Anchor suggestions
        </h3>
        {anchors.length === 0 ? (
          <EmptySection>No unsourced claims flagged.</EmptySection>
        ) : (
          <ul className="flex flex-col gap-2 px-4 py-3">
            {anchors.map((a, i) => (
              <li key={i} className="text-[13px] leading-snug text-text-1">
                <p>&ldquo;{a.claim}&rdquo;</p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-text-3">
                  suggest: {a.suggestedSourceType}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="quotables-heading">
        <h3
          id="quotables-heading"
          className="px-4 pt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-text-3"
        >
          Quotables
        </h3>
        {quotables.length === 0 ? (
          <EmptySection>No standalone quotable sentences found.</EmptySection>
        ) : (
          <ul className="flex flex-col gap-2 px-4 py-3">
            {quotables.map((q, i) => (
              <li
                key={i}
                className="border-l-2 border-line-strong pl-2 text-[13px] italic leading-snug text-text-2"
              >
                &ldquo;{q}&rdquo;
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="qa-pairs-heading">
        <h3
          id="qa-pairs-heading"
          className="px-4 pt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-text-3"
        >
          Q&amp;A pairs
        </h3>
        {qaPairs.length === 0 ? (
          <EmptySection>No Q&amp;A pairs extracted.</EmptySection>
        ) : (
          <dl className="flex flex-col gap-3 px-4 py-3">
            {qaPairs.map((qa, i) => (
              <div key={i}>
                <dt className="text-[13px] font-medium text-text-1">{qa.question}</dt>
                <dd className="mt-0.5 text-[12px] leading-snug text-text-2">{qa.answer}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </Card>
  );
}
