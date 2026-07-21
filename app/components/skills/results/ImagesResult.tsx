import type { ImagesSkillResult, SkillTask } from "@/lib/skills/types";
import { StatGrid } from "../StatGrid";

function readResult(task: SkillTask): ImagesSkillResult | null {
  if (task.resultVersion !== 1 || !task.result) return null;
  const result = task.result as Partial<ImagesSkillResult>;
  if (!Array.isArray(result.missingAlt) || !Array.isArray(result.oversized)) return null;
  return result as ImagesSkillResult;
}

/** DATA-CONTRACT §8.1 ImagesSkillResult renderer. */
export function ImagesResult({ task }: { task: SkillTask }) {
  const result = readResult(task);
  if (!result) return <p className="text-xs text-text-3">Unrecognized result version — rerun this check.</p>;

  const clean = result.missingAlt.length === 0 && result.oversized.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <StatGrid
        stats={[
          ["Images", result.imageCount],
          ["Missing alt", result.missingAlt.length],
          ["Oversized", result.oversized.length],
        ]}
      />

      {clean ? (
        <p className="text-xs text-text-3">No image issues found.</p>
      ) : (
        <>
          {result.missingAlt.length > 0 && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-text-3">Missing alt text</p>
              <ul className="mt-1 divide-y divide-line rounded-[var(--radius-lg,5px)] border border-line">
                {result.missingAlt.map((url) => (
                  <li key={url} className="min-w-0 truncate px-3 py-1.5 font-mono text-[11px] text-text-2">
                    {url}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.oversized.length > 0 && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wider text-text-3">Oversized images</p>
              <ul className="mt-1 divide-y divide-line rounded-[var(--radius-lg,5px)] border border-line">
                {result.oversized.map((image) => (
                  <li key={image.url} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="min-w-0 truncate font-mono text-[11px] text-text-2">{image.url}</span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-3">
                      {Math.round(image.bytes / 1024)} KB
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
