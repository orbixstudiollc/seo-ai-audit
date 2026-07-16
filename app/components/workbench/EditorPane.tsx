"use client";

import { Card } from "@/app/components/ui/Card";
import { Button } from "@/app/components/ui/Button";

type Props = {
  content: string;
  onChange: (next: string) => void;
  wordCount: number;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;
  onSave: () => void;
};

/**
 * The working-document editor. Plain monospace textarea over the pasted
 * markdown — the source of truth the whole workbench re-scores against.
 * Unsaved edits get a Save affordance; Re-score also persists before auditing.
 */
export function EditorPane({ content, onChange, wordCount, isDirty, isSaving, saveError, onSave }: Props) {
  return (
    <Card
      label="Working document"
      className="h-full"
      bodyClassName="flex flex-col"
      aside={
        <span className="flex items-center gap-3 font-mono text-[10px] text-text-3">
          <span>{wordCount.toLocaleString()} words</span>
          {saveError && (
            <span role="alert" style={{ color: "var(--score-weak)" }}>
              {saveError}
            </span>
          )}
          {isDirty && (
            <>
              <span className="inline-flex items-center gap-1 text-accent-ink">
                <span aria-hidden="true">●</span> unsaved edits
              </span>
              <Button size="sm" variant="outline" onClick={onSave} disabled={isSaving}>
                {isSaving ? "Saving…" : "Save"}
              </Button>
            </>
          )}
        </span>
      }
    >
      <textarea
        value={content}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        aria-label="Working document content"
        className="h-full min-h-[24rem] w-full flex-1 resize-none bg-transparent px-4 py-3.5 font-mono text-[13px] leading-relaxed text-text-1 caret-accent-ink outline-none placeholder:text-text-3"
        placeholder="Paste your article as markdown to begin…"
      />
    </Card>
  );
}
