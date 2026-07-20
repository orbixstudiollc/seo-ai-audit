import type { ReactNode } from "react";

type Props = {
  /** Mono eyebrow label rendered in the header rule. */
  label?: string;
  /**
   * Element the label renders as. Sections that ARE a document landmark
   * (report sections asserted by role in e2e/a11y) pass a heading level;
   * purely decorative eyebrows keep the default span.
   */
  labelAs?: "span" | "h2" | "h3";
  /** Right-aligned header slot (counts, controls). */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

/**
 * The workbench surface primitive: a raised panel with a hairline border and
 * an optional mono eyebrow header separated by a rule. Tight radius, Swiss.
 */
export function Card({ label, labelAs: LabelTag = "span", aside, children, className = "", bodyClassName = "" }: Props) {
  return (
    <section
      className={`flex min-h-0 flex-col border border-line bg-surface-1 rounded-[var(--radius-lg,5px)] ${className}`}
    >
      {(label || aside) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2">
          {label ? (
            <LabelTag className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-text-3">
              {label}
            </LabelTag>
          ) : (
            <span />
          )}
          {aside}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
