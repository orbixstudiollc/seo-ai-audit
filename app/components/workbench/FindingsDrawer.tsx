"use client";

import { useRef } from "react";
import type { FindingItem } from "@/lib/audit/derive";
import { SeverityChip } from "@/app/components/ui/SeverityChip";

type Props = {
  items: FindingItem[];
  onActivate: (item: FindingItem) => void;
};

/**
 * Severity-ranked findings list with roving-focus keyboard navigation
 * (Up/Down to move, Home/End to jump, Enter/Space to activate). Blockers first,
 * then gaps, then weak signals.
 */
export function FindingsDrawer({ items, onActivate }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusAt(index: number) {
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    refs.current[clamped]?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusAt(index + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusAt(index - 1);
        break;
      case "Home":
        e.preventDefault();
        focusAt(0);
        break;
      case "End":
        e.preventDefault();
        focusAt(items.length - 1);
        break;
    }
  }

  if (items.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[13px] text-text-3">
        No findings yet. Run an audit to surface blockers, question gaps, and weak signals.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line" role="list" aria-label="Audit findings">
      {items.map((item, index) => (
        <li key={item.id} role="listitem">
          <button
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            onClick={() => onActivate(item)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-ink"
          >
            <SeverityChip severity={item.severity} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium leading-snug text-text-1">{item.title}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-text-2">{item.detail}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
