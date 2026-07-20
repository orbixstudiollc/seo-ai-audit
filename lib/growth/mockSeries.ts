import { DET_SIGNAL_IDS, LENSES, type DetSignalId, type Lens } from "@aeo/scoring";
import type { GrowthSeries, GrowthSnapshot, TrackedSite } from "./types";

/**
 * DATA-CONTRACT §13 canonical mock — g2-ui builds against this before the
 * g2-api routes exist. 30 days containing a pre-first-audit stretch
 * (lens: null), one failed-fetch day (err), a visible upward lens trend, and
 * a changed newest day so the "page changed" badge is exercised.
 */

export const MOCK_TRACKED_URL = "https://rising.example/page";

const DAY_MS = 86_400_000;
const START_UTC = Date.UTC(2026, 5, 20); // 2026-06-20 → 30 days ending 2026-07-19
const FIRST_AUDIT_DAY = 6; // lens stays null before this index
const ERR_DAY = 7; // the one fetch-failed day
const CHANGED_DAY = 29; // newest day — drives the "page changed" badge

const quant5 = (value: number): number => Math.max(0, Math.min(100, Math.round(value / 5) * 5));

function detFor(base: number): Record<DetSignalId, number> {
  const det = {} as Record<DetSignalId, number>;
  DET_SIGNAL_IDS.forEach((id, index) => {
    det[id] = quant5(base + ((index * 7) % 25) - 10);
  });
  return det;
}

function lensFor(base: number): Record<Lens, number> {
  const lens = {} as Record<Lens, number>;
  LENSES.forEach((id, index) => {
    lens[id] = Math.max(0, Math.min(100, base + index * 2));
  });
  return lens;
}

function buildSeries(): GrowthSnapshot[] {
  const series: GrowthSnapshot[] = [];
  for (let day = 0; day < 30; day++) {
    const d = new Date(START_UTC + day * DAY_MS).toISOString().slice(0, 10);
    if (day === ERR_DAY) {
      series.push({ d, det: null, lens: null, err: true });
      continue;
    }
    const snapshot: GrowthSnapshot = {
      d,
      det: detFor(50 + day),
      lens: day < FIRST_AUDIT_DAY ? null : lensFor(55 + Math.round((day - FIRST_AUDIT_DAY) * 0.9)),
    };
    series.push(day === CHANGED_DAY ? { ...snapshot, changed: true } : snapshot);
  }
  return series;
}

export const MOCK_GROWTH_SERIES: GrowthSeries = {
  url: MOCK_TRACKED_URL,
  signalsVersion: "signals-v2",
  series: buildSeries(),
};

export const MOCK_TRACKED_SITES: TrackedSite[] = [
  {
    url: MOCK_TRACKED_URL,
    createdAt: "2026-06-20T08:00:00.000Z",
    lastRunAt: "2026-07-19T08:05:00.000Z",
  },
  {
    url: "https://tracked-only.example/",
    createdAt: "2026-07-18T09:00:00.000Z",
    lastRunAt: null,
  },
];
