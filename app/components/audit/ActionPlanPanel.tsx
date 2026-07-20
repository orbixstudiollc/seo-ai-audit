import type { ActionItem, ActionPlan, ActionSeverity, ActionEffort } from "@/lib/skills/actionPlan";
import { Card } from "@/app/components/ui/Card";

type Props = {
  plan: ActionPlan | null;
};

/**
 * Renders a synthesized {@link ActionPlan} as a prioritized, severity-ranked
 * checklist. Reuses the existing severity color tokens (the same CSS vars
 * SeverityChip uses) and mono/Swiss type — it introduces no new colors or
 * status vocabulary, per the platform design guardrail.
 */
const SEVERITY_STYLE: Record<ActionSeverity, { label: string; glyph: string; colorVar: string; tintVar: string }> = {
  critical: { label: "Critical", glyph: "●", colorVar: "var(--sev-blocker)", tintVar: "var(--sev-blocker-tint)" },
  high: { label: "High", glyph: "◆", colorVar: "var(--sev-gap)", tintVar: "var(--sev-gap-tint)" },
  medium: { label: "Medium", glyph: "▪", colorVar: "var(--sev-weak)", tintVar: "var(--sev-weak-tint)" },
  low: { label: "Low", glyph: "·", colorVar: "var(--text-3)", tintVar: "transparent" },
};

const EFFORT_LABEL: Record<ActionEffort, string> = {
  quick: "Quick",
  moderate: "Moderate",
  project: "Project",
};

function ActionBadge({ severity }: { severity: ActionSeverity }) {
  const { label, glyph, colorVar, tintVar } = SEVERITY_STYLE[severity];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
      style={{ color: colorVar, backgroundColor: tintVar, borderColor: colorVar }}
    >
      <span aria-hidden="true">{glyph}</span>
      {label}
    </span>
  );
}

function Row({ item }: { item: ActionItem }) {
  const affected = item.urls.length;
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <ActionBadge severity={item.severity} />
        <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-text-1">{item.title}</span>
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-text-3">
          {EFFORT_LABEL[item.effort]}
        </span>
      </div>
      <p className="text-[12px] leading-snug text-text-2">{item.detail}</p>
      {affected > 1 && (
        <p className="font-mono text-[10px] uppercase tracking-wide text-text-3">
          {affected} page{affected === 1 ? "" : "s"} affected
        </p>
      )}
    </li>
  );
}

/**
 * The "Action plan" report section. Renders nothing until a plan exists (same
 * progressive-render posture as the rest of the report), and shows a positive
 * empty state when the synthesizer found nothing to fix.
 */
export function ActionPlanPanel({ plan }: Props) {
  if (!plan) return null;

  const count = plan.items.length;

  return (
    <Card
      label="Action plan"
      aside={
        count > 0 ? (
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-3">
            {count} item{count === 1 ? "" : "s"}
          </span>
        ) : undefined
      }
    >
      {count === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-text-3">
          No action items — every checked signal is in good shape.
        </p>
      ) : (
        <ul aria-label="Action plan" className="divide-y divide-line">
          {plan.items.map((item) => (
            <Row key={item.id} item={item} />
          ))}
        </ul>
      )}
    </Card>
  );
}
