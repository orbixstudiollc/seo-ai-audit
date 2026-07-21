import type { AgentStreamEvent } from "@/lib/skills/types";
import type { ActionPlan } from "@/lib/skills/actionPlan";
import { schemaMocks } from "@/lib/skills/mocks/schema";
import { sitemapMocks } from "@/lib/skills/mocks/sitemap";
import { imagesMocks } from "@/lib/skills/mocks/images";
import { aiAccessMocks } from "@/lib/skills/mocks/ai-access";
import { backlinksMocks } from "@/lib/skills/mocks/backlinks";
import { labsMocks } from "@/lib/skills/mocks/labs";

/**
 * DATA-CONTRACT §9 canonical mock — SK2's agent-mode UI (useAgentStream,
 * AgentReportView) builds against these before the orchestrator route
 * exists. Reuses the already-built §8 skill mocks for `agent:skill-done`
 * tasks rather than inventing a second set of fixtures to drift out of sync.
 */

const PLAN: Extract<AgentStreamEvent, { type: "agent:plan" }> = {
  type: "agent:plan",
  runId: "mock-run-1",
  businessType: "saas",
  skills: [
    { skillId: "schema", mode: "inline", estCostUsd: 0 },
    { skillId: "sitemap", mode: "inline", estCostUsd: 0 },
    { skillId: "images", mode: "inline", estCostUsd: 0 },
    { skillId: "ai-access", mode: "inline", estCostUsd: 0 },
    { skillId: "backlinks", mode: "inline", estCostUsd: 0.02 },
    { skillId: "labs", mode: "inline", estCostUsd: 0.01 },
    { skillId: "technical-crawl", mode: "handoff", estCostUsd: 0.05 },
  ],
};

const ACTION_PLAN: ActionPlan = {
  generatedAt: "2026-07-20T09:05:00.000Z",
  items: [
    {
      id: "blocker-no-self-contained-answer-block-in-the-intro",
      severity: "critical",
      title: "No self-contained answer block in the intro",
      detail: "Blocks AI-Overview citation — Introduction.",
      source: "S18",
      urls: ["https://example.test/guide-to-oat-milk"],
      effort: "moderate",
    },
    {
      id: "cap-citability",
      severity: "high",
      title: "Citability is capped at 50",
      detail: "Stat density and citation density are both near zero.",
      source: "cap:citability",
      urls: ["https://example.test/guide-to-oat-milk"],
      effort: "moderate",
    },
    {
      id: "gap-answer-is-oat-milk-gluten-free",
      severity: "medium",
      title: "Answer: Is oat milk gluten-free?",
      detail: "A question a thorough article on this topic should answer but doesn't.",
      source: "S13",
      urls: ["https://example.test/guide-to-oat-milk"],
      effort: "moderate",
    },
    {
      id: "issue-no_image_alt",
      severity: "low",
      title: "Images missing alt text",
      detail: "2 pages affected (DataForSEO on-page check `no_image_alt`).",
      source: "issue:no_image_alt",
      urls: ["https://example.test/guide-to-oat-milk", "https://example.test/pricing"],
      effort: "quick",
    },
  ],
};

/** A full run: plan → inline skills → a handoff → rollup → done. */
export const mockAgentRunEvents: AgentStreamEvent[] = [
  PLAN,
  { type: "agent:skill-start", skillId: "schema" },
  { type: "agent:skill-done", skillId: "schema", task: schemaMocks.complete },
  { type: "agent:skill-start", skillId: "sitemap" },
  { type: "agent:skill-done", skillId: "sitemap", task: sitemapMocks.complete },
  { type: "agent:skill-start", skillId: "images" },
  { type: "agent:skill-done", skillId: "images", task: imagesMocks.complete },
  { type: "agent:skill-start", skillId: "ai-access" },
  { type: "agent:skill-done", skillId: "ai-access", task: aiAccessMocks.complete },
  { type: "agent:skill-start", skillId: "backlinks" },
  { type: "agent:skill-done", skillId: "backlinks", task: backlinksMocks.complete },
  { type: "agent:skill-start", skillId: "labs" },
  { type: "agent:skill-done", skillId: "labs", task: labsMocks.complete },
  { type: "agent:skill-handoff", skillId: "technical-crawl", taskId: "mock-task-tech-1" },
  { type: "agent:rollup", runId: "mock-run-1", actionPlan: ACTION_PLAN, pendingTaskIds: ["mock-task-tech-1"] },
  { type: "agent:done" },
];

/** The `planOnly` dry run (§9 v1.5): plan → done, zero fan-out, $0 spend. */
export const mockAgentPlanOnlyEvents: AgentStreamEvent[] = [
  { ...PLAN, runId: "mock-run-plan-only" },
  { type: "agent:done" },
];

/** A run rejected before fan-out because it would exceed the run budget cap. */
export const mockAgentErrorEvents: AgentStreamEvent[] = [
  { ...PLAN, runId: "mock-run-error" },
  { type: "agent:error", kind: "budget_exceeded", message: "This run would exceed the monthly skill budget." },
];
