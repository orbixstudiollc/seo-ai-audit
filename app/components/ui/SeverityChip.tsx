import type { FindingSeverity } from "@/lib/audit/derive";

type Props = {
  severity: FindingSeverity;
  className?: string;
};

/**
 * Findings severity marker. Color is backed by a glyph + label so the class of
 * a finding is never conveyed by color alone.
 */
const CONFIG: Record<FindingSeverity, { label: string; glyph: string; colorVar: string; tintVar: string }> = {
  blocker: { label: "Blocker", glyph: "●", colorVar: "var(--sev-blocker)", tintVar: "var(--sev-blocker-tint)" },
  gap: { label: "Gap", glyph: "◆", colorVar: "var(--sev-gap)", tintVar: "var(--sev-gap-tint)" },
  weak: { label: "Weak signal", glyph: "▪", colorVar: "var(--sev-weak)", tintVar: "var(--sev-weak-tint)" },
};

export function SeverityChip({ severity, className = "" }: Props) {
  const { label, glyph, colorVar, tintVar } = CONFIG[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${className}`}
      style={{ color: colorVar, backgroundColor: tintVar, borderColor: colorVar }}
    >
      <span aria-hidden="true">{glyph}</span>
      {label}
    </span>
  );
}
