import { describe, expect, it } from "vitest";
import type { GrowthSnapshot } from "./types";
import { seriesScores, snapshotScore } from "./series";
import { MOCK_GROWTH_SERIES } from "./mockSeries";

const day = (overrides: Partial<GrowthSnapshot>): GrowthSnapshot =>
  ({ d: "2026-07-01", det: null, lens: null, ...overrides }) as GrowthSnapshot;

describe("snapshotScore", () => {
  it("prefers the lens average when lens data exists", () => {
    const snapshot = day({
      det: { S1: 0, S2: 0 } as GrowthSnapshot["det"],
      lens: { aeo: 60, geo: 62, citability: 64, aiOverview: 66 },
    });
    expect(snapshotScore(snapshot)).toBe(63);
  });

  it("falls back to the det average before the first audit", () => {
    const snapshot = day({ det: { S1: 50, S2: 60, S3: 70 } as GrowthSnapshot["det"] });
    expect(snapshotScore(snapshot)).toBe(60);
  });

  it("returns null on err days with no data", () => {
    expect(snapshotScore(day({ err: true }))).toBeNull();
  });
});

describe("seriesScores", () => {
  it("maps chronologically and drops err days", () => {
    const scores = seriesScores(MOCK_GROWTH_SERIES.series);
    expect(scores).toHaveLength(29); // 30 days minus the one err day
    expect(scores.every((score) => score >= 0 && score <= 100)).toBe(true);
    expect(scores[scores.length - 1]).toBeGreaterThan(scores[0]); // visible trend
  });

  it("returns an empty array for an empty series", () => {
    expect(seriesScores([])).toEqual([]);
  });
});

describe("MOCK_GROWTH_SERIES — §13 canonical mock invariants", () => {
  const { series } = MOCK_GROWTH_SERIES;

  it("has 30 unique ascending days", () => {
    expect(series).toHaveLength(30);
    const dates = series.map((snapshot) => snapshot.d);
    expect(new Set(dates).size).toBe(30);
    expect([...dates].sort()).toEqual(dates);
  });

  it("quantizes det scores to 0-100 in steps of 5", () => {
    for (const snapshot of series) {
      for (const score of Object.values(snapshot.det ?? {})) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
        expect(score % 5).toBe(0);
      }
    }
  });

  it("contains an err day, a changed newest day, and a pre-first-audit lens:null stretch", () => {
    expect(series.some((snapshot) => snapshot.err)).toBe(true);
    expect(series[series.length - 1].changed).toBe(true);
    const firstLens = series.findIndex((snapshot) => snapshot.lens !== null);
    expect(firstLens).toBeGreaterThan(0); // initial stretch has lens: null
    expect(series.slice(0, firstLens).every((snapshot) => snapshot.lens === null)).toBe(true);
  });
});
