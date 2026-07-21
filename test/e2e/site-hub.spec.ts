import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROOT = "https://hub-example.test/";
const OLD_ID = "site:hub-example.test:old";
const NEW_ID = "site:hub-example.test:new";

/**
 * Two site audits of one domain: the older one has a finding the newer one
 * resolved, plus a new one. `addInitScript` serializes this function into
 * the page context, so it cannot close over module-scope consts (ROOT,
 * OLD_ID, NEW_ID) — every value must arrive via the `data` argument.
 */
function seedHistory(data: { root: string; oldId: string; newId: string }) {
  const records = [
    {
      id: data.oldId, version: 4, url: data.root, title: "hub-example.test", mode: "site",
      createdAt: "2026-07-15T10:00:00.000Z", status: "complete",
      scores: { aeo: 50, geo: 50, citability: 50, aiOverview: 50 },
      pageCount: 3,
      details: { kind: "site", pagesFailed: 0, worstPages: [{ url: data.root, title: "Home", overallScore: 40 }], commonFindings: [{ issue: "Missing schema", count: 3 }] },
      reportAvailable: true,
    },
    {
      id: data.newId, version: 4, url: data.root, title: "hub-example.test", mode: "site",
      createdAt: "2026-07-19T10:00:00.000Z", status: "complete",
      scores: { aeo: 70, geo: 70, citability: 70, aiOverview: 70 },
      pageCount: 3,
      details: { kind: "site", pagesFailed: 0, worstPages: [], commonFindings: [{ issue: "Thin content", count: 2 }] },
      reportAvailable: true,
    },
  ];
  localStorage.setItem("seo-ai-audit:history:v4", JSON.stringify(records));
}

async function seedReport(page: import("@playwright/test").Page, id: string, rootUrl: string, createdAt: string, rollup: unknown) {
  await page.evaluate(async ({ id, rootUrl, createdAt, rollup }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("seo-ai-audit:reports", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("reports", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("reports", "readwrite");
      transaction.objectStore("reports").put({
        version: 1, id, kind: "site", createdAt, phase: "done",
        state: {
          rootUrl, method: "sitemap",
          discoveredPages: [{ url: rootUrl, source: "sitemap" }],
          truncated: false,
          pages: { [rootUrl]: { phase: "done", url: rootUrl, index: 0, page: null, signals: null, scores: null, findings: null, rewrites: null, error: null } },
          pageOrder: [rootUrl],
          rollup,
          stoppedEarly: null,
          error: null,
        },
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, { id, rootUrl, createdAt, rollup });
}

/** Seeds the full golden-path domain (2 history records + their saved reports) and opens its hub. */
async function seedFullDomainAndOpenHub(page: import("@playwright/test").Page) {
  await page.addInitScript(seedHistory, { root: ROOT, oldId: OLD_ID, newId: NEW_ID });
  await page.goto("/");
  await seedReport(page, OLD_ID, ROOT, "2026-07-15T10:00:00.000Z", {
    pagesAudited: 3, pagesFailed: 0, avgScores: { aeo: 50, geo: 50, citability: 50, aiOverview: 50 },
    worstPages: [{ url: ROOT, title: "Home", overallScore: 40 }],
    commonFindings: [{ issue: "Missing schema", count: 3 }],
  });
  await seedReport(page, NEW_ID, ROOT, "2026-07-19T10:00:00.000Z", {
    pagesAudited: 3, pagesFailed: 0, avgScores: { aeo: 70, geo: 70, citability: 70, aiOverview: 70 },
    worstPages: [],
    commonFindings: [{ issue: "Thin content", count: 2 }],
  });
  await page.goto("/site/hub-example.test");
}

test("site hub shows growth trend, action plan, technical panel, and history for a domain", async ({ page }) => {
  await seedFullDomainAndOpenHub(page);

  await expect(page.getByRole("heading", { name: "hub-example.test", exact: true })).toBeVisible();
  await expect(page.getByText("2 audits")).toBeVisible();

  // Action plan reflects the LATEST report's rollup finding, not the old one.
  await expect(page.getByRole("heading", { name: "Action plan" })).toBeVisible();
  await expect(page.getByText("Thin content", { exact: true })).toBeVisible();

  // Burndown diff: "Missing schema" + the worst-pages item resolved (old
  // report only), "Thin content" introduced (new report only) — this is the
  // regression case for the id-stability bug (commonFindings sorted by
  // count means positional ids would misattribute this as 0 resolved).
  await expect(page.getByRole("heading", { name: "Issues found per audit" })).toBeVisible();
  await expect(page.getByText("Since the previous audit: 2 resolved · 1 new", { exact: true })).toBeVisible();

  // Technical crawl panel mounts for the latest site-kind report (explicit-start, no crawl triggered).
  await expect(page.getByRole("button", { name: "Run technical crawl" })).toBeVisible();

  // Audit history lists both records with working "Open report" links.
  await expect(page.getByRole("heading", { name: "Audit history" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open report" })).toHaveCount(2);

  // The per-domain SkillPanel checks: every HUB_SKILL_IDS entry was
  // flag-flipped after its live deploy smoke (SK-wave discipline), so
  // each renders its idle panel with an explicit-start button.
  for (const label of ["Schema", "Sitemap", "Hreflang", "Images", "AI access", "Backlinks", "Labs", "SERP", "Keywords"]) {
    await expect(page.getByRole("heading", { name: label, level: 2 })).toBeVisible();
  }
});

test("paid skill panels POST the owning auditId, and keyword panels gate on input", async ({ page }) => {
  // Regression for a real production bug: SkillPanel used to POST { scope }
  // only, but every PAID route requires { auditId, scope } for ownership +
  // ledger anchoring — the hub's paid Run buttons 400'd. The mock rejects
  // auditId-less requests exactly like the real route.
  let backlinksBody: { auditId?: string; scope?: unknown } | null = null;
  await page.route("/api/skills/backlinks", async (route) => {
    backlinksBody = (await route.request().postDataJSON()) as { auditId?: string; scope?: unknown };
    if (!backlinksBody.auditId) {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "invalid_scope" }) });
      return;
    }
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ task: {
        id: "mock-backlinks-live", skillId: "backlinks",
        scope: { kind: "site", url: ROOT }, status: "complete",
        createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z",
        costUsd: 0.02, resultVersion: 1,
        result: { totalBacklinks: 10, referringDomains: 5, rank: 100, brokenBacklinks: 1, referringDomainsNofollow: 2 },
      }, reused: false }),
    });
  });

  await seedFullDomainAndOpenHub(page);
  await page.getByRole("button", { name: "Run backlink pull" }).click();
  await expect(page.getByText("Referring domains")).toBeVisible();
  // toMatchObject (not property access): TS can't see the closure write and
  // narrows the variable to its initial null.
  expect(backlinksBody).toMatchObject({ auditId: NEW_ID });

  // Keyword-scoped panels: Run is disabled until the keyword input is filled.
  const serpRun = page.getByRole("button", { name: "Run SERP pull" });
  await expect(serpRun).toBeDisabled();
  await page.getByLabel("Keyword for SERP").fill("seo audit tool");
  await expect(serpRun).toBeEnabled();
});

test("site hub's Run agent audit button navigates to the agent audit page for the domain's latest URL", async ({ page }) => {
  await seedFullDomainAndOpenHub(page);
  await page.getByRole("button", { name: "Run agent audit" }).click();
  await expect(page).toHaveURL(`/audit/agent?url=${encodeURIComponent(ROOT)}`);
});

test("site hub shows an empty state for a domain with no audits", async ({ page }) => {
  await page.goto("/site/never-audited.example");
  await expect(page.getByRole("heading", { name: "No audits yet for never-audited.example" })).toBeVisible();
  await expect(page.getByRole("link", { name: "← Start an audit" })).toBeVisible();
});

test("growth card domain heading links into the site hub", async ({ page }) => {
  await page.addInitScript(seedHistory, { root: ROOT, oldId: OLD_ID, newId: NEW_ID });
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "hub-example.test", exact: true }).click();
  await expect(page).toHaveURL(/\/site\/hub-example\.test$/);
  await expect(page.getByRole("heading", { name: "hub-example.test", exact: true })).toBeVisible();
});

test("site hub has no critical or serious accessibility violations", async ({ page }) => {
  await seedFullDomainAndOpenHub(page);
  await expect(page.getByRole("heading", { name: "hub-example.test", exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const severe = results.violations.filter((violation) =>
    violation.impact === "critical" || violation.impact === "serious");
  expect(severe).toEqual([]);
});

test("site hub stays inside the viewport at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await seedFullDomainAndOpenHub(page);
  await expect(page.getByRole("heading", { name: "hub-example.test", exact: true })).toBeVisible();
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
});
