/**
 * The 4-tile mono stat grid, lifted from TechnicalSeoPanel so every skill
 * result renderer shares one look. Cols adapt to the stat count (2-4 is the
 * common case; 5 falls back to a wider large-screen grid rather than
 * cramming a 5th tile into a 4-col row).
 */

type Stat = [label: string, value: string | number];

function gridCols(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-2";
  if (count === 3) return "grid-cols-3";
  if (count === 4) return "grid-cols-2 sm:grid-cols-4";
  return "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5";
}

export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <div className={`grid gap-2 ${gridCols(stats.length)}`}>
      {stats.map(([label, value]) => (
        <div key={label} className="border border-line bg-surface-2 p-2.5">
          <p className="font-mono text-[9px] uppercase tracking-wider text-text-3">{label}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-text-1">{value}</p>
        </div>
      ))}
    </div>
  );
}
