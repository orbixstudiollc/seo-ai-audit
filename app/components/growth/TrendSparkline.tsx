import { scoreBand } from "@/lib/audit/scoreScale";

type Props = {
  /** Chronological overall scores (0–100), oldest first. */
  series: readonly number[];
  /** What one point is, for the accessible label: "audits" (G1) or "days" (daily series). */
  noun?: "audits" | "days";
};

const WIDTH = 120;
const HEIGHT = 28;
const PAD = 3;

/**
 * Minimal SVG score sparkline — design-token stroke, latest point emphasized
 * with the score-band color (always paired with the numeric label rendered by
 * the parent, never color-only). No chart library.
 */
export function TrendSparkline({ series, noun = "audits" }: Props) {
  if (series.length < 2) return null;

  const min = Math.min(...series, 0);
  const max = Math.max(...series, 100);
  const range = max - min || 1;
  const step = (WIDTH - PAD * 2) / (series.length - 1);
  const points = series.map((score, index) => {
    const x = PAD + index * step;
    const y = HEIGHT - PAD - ((score - min) / range) * (HEIGHT - PAD * 2);
    return [x, y] as const;
  });
  const latest = points[points.length - 1];
  const latestScore = series[series.length - 1];

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-7 w-full"
      role="img"
      aria-label={`Score trend across ${series.length} ${noun}, latest ${latestScore} out of 100`}
      preserveAspectRatio="none"
    >
      <polyline
        points={points.map(([x, y]) => `${x},${y}`).join(" ")}
        fill="none"
        stroke="var(--line-strong)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={latest[0]} cy={latest[1]} r="2.5" fill={scoreBand(latestScore).colorVar} />
    </svg>
  );
}
