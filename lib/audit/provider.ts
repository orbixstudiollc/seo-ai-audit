import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { e2eMockModel } from "./testModel";

/**
 * Server-key model construction. v1 is anonymous and stateless: every audit
 * runs on the server's own ANTHROPIC_API_KEY (Vercel env), never a
 * user-supplied key — BYOK, per-user key storage, and multi-provider choice
 * are gone with the auth/DB teardown.
 */

/** `cheap` runs the RUB scoring call (call 1, consistency-optimized, temp 0);
 * `strong` runs the rewrite generator (call 2, quality-optimized). */
export type Tier = "cheap" | "strong";

const MODEL_IDS: Record<Tier, string> = {
  cheap: "claude-haiku-4-5-20251001",
  strong: "claude-sonnet-5",
};

/** The concrete model id a tier resolves to — known up front, independent of the SDK's post-response value. */
export function serverModelId(tier: Tier): string {
  return MODEL_IDS[tier];
}

/**
 * Builds a `LanguageModel` for one pipeline tier from the server's own key.
 * `experimental_telemetry` is deliberately never enabled by any caller of the
 * returned model — no tracing pipeline ever sees prompts or the key.
 */
export function buildServerModel(tier: Tier): LanguageModel {
  // ponytail: test/CI escape hatch. AUDIT_TEST_MOCK=1 is set only by the test
  // suite and the Playwright dev server, so the real key path below is
  // unchanged in prod — this returns a deterministic offline model so tests
  // and e2e never spend a real key.
  if (process.env.AUDIT_TEST_MOCK === "1") {
    return e2eMockModel(tier);
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }
  return createAnthropic({ apiKey })(MODEL_IDS[tier]);
}
