import type { AuditRewrites } from "@/lib/audit/types";
import { Card } from "@/app/components/ui/Card";
import { DiffHunk } from "@/app/components/ui/DiffHunk";

type Props = {
  rewrites: AuditRewrites | null;
};

/** Read-only before/after rewrite hunks — no accept/reject editing in v1 (no editable document to apply them to). */
export function RewritesPanel({ rewrites }: Props) {
  if (!rewrites || rewrites.hunks.length === 0) {
    return (
      <Card label="Rewrites" className="min-h-0">
        <p className="px-4 py-6 text-center text-[13px] text-text-3">
          Rewrites stream in after scoring.
        </p>
      </Card>
    );
  }

  return (
    <Card label="Rewrites" className="min-h-0" bodyClassName="flex flex-col gap-2.5 p-3">
      {rewrites.hunks.map((hunk) => (
        <DiffHunk key={hunk.id} hunk={hunk} status="pending" readOnly />
      ))}
    </Card>
  );
}
