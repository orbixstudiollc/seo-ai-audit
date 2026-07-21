import { test, expect, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * The agent-mode journey, mocked at the network boundary: landing form ->
 * "Agent" mode -> /audit/agent?url= -> a mocked POST /api/audit/agent SSE
 * stream (DATA-CONTRACT §9) -> the confirm-gate plan card -> confirmed
 * fan-out -> a handoff skill resolved via a mocked GET /api/skills/
 * technical-crawl poll -> the rollup's ActionPlanPanel. The real
 * /api/audit/agent route doesn't exist yet (SK3) — this pins the client
 * contract (useAgentStream + AgentReportView) against the shape it will need
 * to match.
 */

const AUDIT_URL = "https://example.test/";

const PLAN_SKILLS = [
  { skillId: "schema", mode: "inline", estCostUsd: 0 },
  { skillId: "images", mode: "inline", estCostUsd: 0 },
  { skillId: "technical-crawl", mode: "handoff", estCostUsd: 0.05 },
];

const planOnlyEvents = [
  { type: "agent:plan", runId: "run-plan-only", businessType: "saas", skills: PLAN_SKILLS },
  { type: "agent:done" },
];

const fullRunEvents = [
  { type: "agent:plan", runId: "run-1", businessType: "saas", skills: PLAN_SKILLS },
  { type: "agent:skill-start", skillId: "schema" },
  {
    type: "agent:skill-done",
    skillId: "schema",
    task: {
      id: "task-schema-1", skillId: "schema", scope: { kind: "page", url: AUDIT_URL }, status: "complete",
      createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:01.000Z", costUsd: 0, resultVersion: 1,
      result: { detected: [], missingRecommended: [], generated: [] },
    },
  },
  { type: "agent:skill-start", skillId: "images" },
  {
    type: "agent:skill-done",
    skillId: "images",
    task: {
      id: "task-images-1", skillId: "images", scope: { kind: "page", url: AUDIT_URL }, status: "complete",
      createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:01.000Z", costUsd: 0, resultVersion: 1,
      result: { imageCount: 4, missingAlt: [], oversized: [], issues: [] },
    },
  },
  { type: "agent:skill-handoff", skillId: "technical-crawl", taskId: "mock-task-tech-1" },
  {
    type: "agent:rollup",
    runId: "run-1",
    actionPlan: {
      generatedAt: "2026-07-21T00:00:02.000Z",
      items: [{
        id: "issue-no_image_alt", severity: "low", title: "Images missing alt text",
        detail: "1 page affected.", source: "issue:no_image_alt", urls: [AUDIT_URL], effort: "quick",
      }],
    },
    pendingTaskIds: ["mock-task-tech-1"],
  },
  { type: "agent:done" },
];

const errorEvents = [
  { type: "agent:plan", runId: "run-error", businessType: "saas", skills: PLAN_SKILLS },
  { type: "agent:error", kind: "budget_exceeded", message: "This run would exceed the monthly skill budget." },
];

function sseBody(events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

async function routeAgentStream(route: Route, planOnlyBody: unknown[], confirmedBody: unknown[]): Promise<void> {
  // The real route is owner-gated (401 without the header) — a consumer that
  // regresses to plain fetch must fail here, not only in production smokes.
  if (!route.request().headers()["x-seo-audit-owner"]) {
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "invalid_owner" }) });
    return;
  }
  const body = (await route.request().postDataJSON()) as { url: string; planOnly?: boolean };
  await route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: sseBody(body.planOnly ? planOnlyBody : confirmedBody),
  });
}

/** GET /api/skills/technical-crawl?id= — queued on the first poll, complete on the second. */
function routeTechnicalCrawlPoll() {
  let calls = 0;
  return async (route: Route) => {
    calls += 1;
    const complete = calls >= 2;
    const task = {
      id: "mock-task-tech-1",
      skillId: "technical-crawl",
      scope: { kind: "site", url: AUDIT_URL },
      status: complete ? "complete" : "queued",
      createdAt: "2026-07-21T00:00:02.000Z",
      updatedAt: "2026-07-21T00:00:07.000Z",
      costUsd: complete ? 0.05 : 0,
      resultVersion: 1,
      result: complete ? { pagesCrawled: 12, onpageScore: 77 } : null,
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ task }) });
  };
}

test("plans, confirms, fans out inline skills, resolves a handoff, and shows the rollup", async ({ page }) => {
  const skillRequests: string[] = [];
  const pollHandler = routeTechnicalCrawlPoll();
  await page.route("/api/skills/technical-crawl**", async (route) => {
    skillRequests.push(route.request().url());
    await pollHandler(route);
  });
  await page.route("/api/audit/agent", (route) => routeAgentStream(route, planOnlyEvents, fullRunEvents));

  await page.goto("/");
  await page.getByRole("radio", { name: "Agent" }).click();
  await page.getByRole("textbox", { name: "URL to audit" }).fill(AUDIT_URL);
  await page.getByRole("button", { name: "Plan checks" }).click();
  await page.waitForURL(/\/audit\/agent\?url=/);

  // Confirm gate: the plan renders with an estimated total, nothing spent yet.
  await expect(page.getByRole("heading", { name: "Agent plan", level: 2 })).toBeVisible();
  await expect(page.getByText("Estimated total $0.05")).toBeVisible();
  expect(skillRequests).toEqual([]);

  await page.getByRole("button", { name: "Run 3 checks" }).click();

  // Inline skills complete progressively; the rollup (and its action plan) lands.
  await expect(page.getByText("Done")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Action plan", level: 3 })).toBeVisible();
  await expect(page.getByText("Images missing alt text")).toBeVisible();

  // The handoff row polls (queued -> complete) via the mocked GET script.
  await expect(page.getByText("Continues in background")).toBeVisible();
  await expect(page.getByText("Continues in background")).toHaveCount(0, { timeout: 20_000 });
  const technicalRow = page.getByRole("listitem").filter({ hasText: "Technical crawl" });
  await technicalRow.getByText("View result").click();
  await expect(page.getByText("Pages crawled", { exact: true })).toBeVisible();
  await expect(page.getByText("Actual cost so far $0.05")).toBeVisible();
});

test("a run rejected before fan-out shows a blocking budget_exceeded banner and keeps the plan visible", async ({ page }) => {
  const requests: Array<{ url: string; planOnly?: boolean }> = [];
  await page.route("/api/audit/agent", async (route) => {
    const body = (await route.request().postDataJSON()) as { url: string; planOnly?: boolean };
    requests.push(body);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseBody(body.planOnly ? planOnlyEvents : errorEvents),
    });
  });

  await page.goto(`/audit/agent?url=${encodeURIComponent(AUDIT_URL)}`);
  await expect(page.getByRole("heading", { name: "Agent plan", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Run 3 checks" }).click();

  await expect(page.getByText("This run would exceed your monthly skill budget")).toBeVisible();
  // The plan stays up underneath the error banner — nothing already rendered is discarded.
  await expect(page.getByRole("heading", { name: "Agent plan", level: 2 })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]?.planOnly).toBe(true);
  expect(requests[1]?.planOnly).toBeUndefined();
});

/** SK3: reopening a saved agent report (kind "agent") with an unresolved
 * handoff task — the row re-enters polling via the SkillPanel's
 * initialTaskId (SK2) and, once it resolves, the report's status upgrades. */
test("reopening a saved agent report with an unresolved handoff resolves it via the technical-crawl poll", async ({ page }) => {
  const REPORT_ID = "agent:https://example.test/:2026-07-21T00:00:00.000Z";
  await page.route("/api/skills/technical-crawl**", routeTechnicalCrawlPoll());
  await page.goto("/");
  await page.evaluate(async ({ id, url }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("seo-ai-audit:reports", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("reports", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("reports", "readwrite");
      transaction.objectStore("reports").put({
        version: 1, id, kind: "agent", createdAt: "2026-07-21T00:00:00.000Z", phase: "done", url,
        state: {
          phase: "done", runId: "run-1", businessType: "saas",
          skills: [
            {
              skillId: "schema", mode: "inline", estCostUsd: 0, status: "complete", taskId: null,
              task: {
                id: "task-schema-1", skillId: "schema", scope: { kind: "page", url }, status: "complete",
                createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:01.000Z", costUsd: 0, resultVersion: 1,
                result: { detected: [], missingRecommended: [], generated: [] },
              },
            },
            {
              skillId: "technical-crawl", mode: "handoff", estCostUsd: 0.05, status: "handoff",
              task: null, taskId: "mock-task-tech-1",
            },
          ],
          actionPlan: { generatedAt: "2026-07-21T00:00:02.000Z", items: [] },
          pendingTaskIds: ["mock-task-tech-1"],
          error: null,
          planOnly: false,
        },
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, { id: REPORT_ID, url: AUDIT_URL });

  await page.goto(`/report/${encodeURIComponent(REPORT_ID)}`);
  await expect(page.getByRole("heading", { name: "Agent plan", level: 2 })).toBeVisible();

  // Still pending on load — polls and resolves via the mocked GET.
  await expect(page.getByText("Continues in background")).toBeVisible();
  await expect(page.getByText("Continues in background")).toHaveCount(0, { timeout: 20_000 });
  const technicalRow = page.getByRole("listitem").filter({ hasText: "Technical crawl" });
  await expect(technicalRow.getByText("Done")).toBeVisible();
  await technicalRow.getByText("View result").click();
  await expect(page.getByText("Pages crawled", { exact: true })).toBeVisible();
});

test("axe: no critical/serious violations; no horizontal overflow at 320px (running + done)", async ({ page }) => {
  await page.route("/api/skills/technical-crawl**", routeTechnicalCrawlPoll());
  await page.route("/api/audit/agent", (route) => routeAgentStream(route, planOnlyEvents, fullRunEvents));

  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`/audit/agent?url=${encodeURIComponent(AUDIT_URL)}`);
  await expect(page.getByRole("heading", { name: "Agent plan", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: "Run 3 checks" }).click();

  // "running" checkpoint — confirmed, fanning out, handoff still pending.
  await expect(page.getByText("Continues in background")).toBeVisible();
  let overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  let results = await new AxeBuilder({ page }).analyze();
  let severe = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(severe, JSON.stringify(severe, null, 2)).toEqual([]);

  // "done" checkpoint — the handoff resolved, the disclosure expanded.
  await expect(page.getByText("Continues in background")).toHaveCount(0, { timeout: 20_000 });
  const technicalRow = page.getByRole("listitem").filter({ hasText: "Technical crawl" });
  await technicalRow.getByText("View result").click();
  await expect(page.getByText("Pages crawled", { exact: true })).toBeVisible();

  overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  results = await new AxeBuilder({ page }).analyze();
  severe = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(severe, JSON.stringify(severe, null, 2)).toEqual([]);
});
