#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAudit } from "./pipeline";
import { buildMockLanguageModel } from "./testModel";
import type { RubricOutput } from "./rubricSchema";
import { LENSES, SIGNAL_IDS } from "./types";
import type { QuantizedScore, ScoreBreakdown } from "./types";

const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES_DIR = path.join(PACKAGE_DIR, "fixtures");

/** Max allowed drift between two cache-bypassed reruns, per the corrected
 * Phase 0 exit criterion (plan-validation-synthesis amendment #3a): "cache-
 * bypassed fresh reruns stay within the 5-point quantization band" — not
 * byte-identical, which only proves the sha256 cache, not the model. */
const DETERMINISM_BAND = 5;

interface ManifestEntry {
  file: string;
  expectedTier: string;
  expectedRankPosition: number;
}

// ponytail: tier-level granularity only (4 buckets), not a per-fixture
// hand-tuned RUB simulation -- reproducing a real rubric judgment by hand
// would just be a disguised "hard-coded to pass." Good enough to prove the
// CLI plumbing (fixture loading, runAudit wiring, correlation math) end to
// end offline; real rank-correlation validation runs against a real model
// in the spend-capped nightly smoke job (plan amendment #8).
const TIER_RUB_SCORE: Record<string, QuantizedScore> = {
  excellent: 90,
  good: 65,
  mediocre: 40,
  poor: 15,
};

function buildFixedRubricOutput(score: QuantizedScore): RubricOutput {
  const evidence = score > 0 ? "Representative excerpt used for deterministic mock verification." : null;
  return {
    S12: { score, evidence },
    S13: { score, evidence, questionGaps: [] },
    S14: { score, evidence, anchorSuggestions: [] },
    S15: { score, evidence },
    S16: { score, evidence },
    S17: { score, evidence },
    S18: { score, evidence, blockers: [] },
  };
}

function combinedScore(breakdown: ScoreBreakdown): number {
  return LENSES.reduce((sum, lens) => sum + breakdown.lenses[lens].score, 0) / LENSES.length;
}

/** 1-based rank per value, descending (highest value = rank 1). Ties share
 * the average of the ranks they span, so a downstream Pearson-on-ranks
 * computation is a valid Spearman correlation even when values tie. */
function rankOf(values: readonly number[]): number[] {
  const n = values.length;
  const order = values.map((_, i) => i).sort((a, b) => values[b] - values[a]);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[order[j + 1]] === values[order[i]]) j++;
    const averageRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]] = averageRank;
    i = j + 1;
  }
  return ranks;
}

function pearsonCorrelation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  const denom = Math.sqrt(denomA * denomB);
  return denom === 0 ? 1 : numerator / denom;
}

/** Spearman rank correlation coefficient: Pearson correlation of two rank
 * arrays that are already in the same "1 = best" convention (average-rank
 * ties included). Equivalent to the textbook rho formula, but this form
 * stays correct when ties are present. No new dependency needed for an
 * 8-item list. */
function spearmanCorrelation(ranksA: readonly number[], ranksB: readonly number[]): number {
  return pearsonCorrelation(ranksA, ranksB);
}

async function runDeterminismCheck(filePathArg: string): Promise<void> {
  const filePath = path.resolve(process.cwd(), filePathArg);
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error: unknown) {
    console.error(`Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  const model = buildMockLanguageModel(buildFixedRubricOutput(70));

  // Cache-bypassed: two real calls to runAudit against the same mock model
  // instance, nothing memoized in between. Proves both that the mock is
  // deterministic and that runAudit carries no hidden mutable state.
  const [first, second] = await Promise.all([
    runAudit({ content, isHtml: false, model }),
    runAudit({ content, isHtml: false, model }),
  ]);

  const driftedSignals = SIGNAL_IDS.filter(
    (id) => Math.abs(first.signals[id].score - second.signals[id].score) > DETERMINISM_BAND,
  );
  if (driftedSignals.length > 0) {
    console.error(
      `Determinism check FAILED: signal(s) drifted by more than ${DETERMINISM_BAND} points across cache-bypassed reruns: ${driftedSignals.join(", ")}`,
    );
    process.exit(1);
  }

  console.log(JSON.stringify(first, null, 2));
}

async function runRankCheck(): Promise<void> {
  const manifestRaw = await readFile(path.join(FIXTURES_DIR, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as ManifestEntry[];

  const results: Array<{ file: string; expectedRank: number; combinedScore: number }> = [];
  for (const entry of manifest) {
    const content = await readFile(path.join(FIXTURES_DIR, entry.file), "utf8");
    const tierScore = TIER_RUB_SCORE[entry.expectedTier] ?? 50;
    const model = buildMockLanguageModel(buildFixedRubricOutput(tierScore));
    const breakdown = await runAudit({ content, isHtml: false, model });
    results.push({ file: entry.file, expectedRank: entry.expectedRankPosition, combinedScore: combinedScore(breakdown) });
  }

  // combinedScore: higher is better, so rankOf's "largest value -> rank 1"
  // gives a "1 = best" rank array. expectedRankPosition from the manifest
  // is already a "1 = best" rank -- do not re-rank it through rankOf (its
  // raw numbers mean the opposite of a score: smaller is better).
  const computedRanks = rankOf(results.map((r) => r.combinedScore));
  const expectedRanks = results.map((r) => r.expectedRank);
  const rho = spearmanCorrelation(computedRanks, expectedRanks);

  console.log("Fixture rank check (mock model, tier-based RUB scores):\n");
  results
    .map((r, i) => ({ ...r, computedRank: computedRanks[i] }))
    .sort((a, b) => a.expectedRank - b.expectedRank)
    .forEach((r) => {
      console.log(`  ${r.file}: expected #${r.expectedRank}, computed #${r.computedRank} (combined score ${r.combinedScore.toFixed(1)})`);
    });

  const MATCH_THRESHOLD = 0.8;
  console.log(`\nSpearman rank correlation: ${rho.toFixed(3)}`);
  console.log(
    rho >= MATCH_THRESHOLD
      ? `Ranking matches expected order (rho >= ${MATCH_THRESHOLD}).`
      : `Ranking does NOT closely match expected order (rho < ${MATCH_THRESHOLD}).`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--rank-check")) {
    await runRankCheck();
    return;
  }
  const filePath = args[0];
  if (!filePath) {
    console.error("Usage: aeo-score <path-to-markdown-file> | aeo-score --rank-check");
    process.exit(1);
  }
  await runDeterminismCheck(filePath);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
