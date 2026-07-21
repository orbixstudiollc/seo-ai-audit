import { describe, expect, it } from "vitest";
import { mockReport } from "@/lib/audit/mockReport";
import {
  INITIAL_SITE_AUDIT_STREAM_STATE,
  siteAuditStreamReducer,
  type PageRunState,
  type SiteAuditStreamState,
} from "@/app/hooks/useSiteAuditStream";

const ROOT = "https://example.test/";
const GOOD = "https://example.test/good";
const FAILED = "https://example.test/failed";

function completedPage(url: string, index: number): PageRunState {
  return {
    phase: "done",
    url,
    index,
    page: { ...mockReport.page, url, finalUrl: url },
    signals: mockReport.scores.signals as never,
    scores: mockReport.scores,
    findings: mockReport.findings,
    rewrites: mockReport.rewrites,
    error: null,
  };
}

function failedPage(url: string, index: number): PageRunState {
  return {
    phase: "error",
    url,
    index,
    page: null,
    signals: null,
    scores: null,
    findings: null,
    rewrites: null,
    error: { kind: "server", message: "Provider failed." },
  };
}

describe("siteAuditStreamReducer failed-page retry", () => {
  it("replaces only failed pages and recomputes the combined rollup", () => {
    const good = completedPage(GOOD, 0);
    const initial: SiteAuditStreamState = {
      ...INITIAL_SITE_AUDIT_STREAM_STATE,
      phase: "done",
      rootUrl: ROOT,
      method: "sitemap",
      discoveredPages: [{ url: GOOD, source: "sitemap" }, { url: FAILED, source: "sitemap" }],
      pageOrder: [GOOD, FAILED],
      pages: { [GOOD]: good, [FAILED]: failedPage(FAILED, 1) },
      rollup: { pagesAudited: 1, pagesFailed: 1, avgScores: null, worstPages: [], commonFindings: [] },
    };

    let state = siteAuditStreamReducer(initial, { type: "retry-pages", urls: [FAILED] });
    expect(state.pages[GOOD]).toBe(good);
    expect(state.pages[FAILED]?.phase).toBe("connecting");
    expect(state.retryingFailed).toBe(true);

    state = siteAuditStreamReducer(state, { type: "site:discovery-start", rootUrl: ROOT });
    state = siteAuditStreamReducer(state, {
      type: "site:discovery-done",
      rootUrl: ROOT,
      method: "retry",
      pages: [{ url: FAILED, source: "retry" }],
      truncated: false,
    });
    state = siteAuditStreamReducer(state, { type: "site:page-start", url: FAILED, index: 0, total: 1 });
    state = siteAuditStreamReducer(state, { type: "site:page-event", url: FAILED, index: 0, event: { type: "meta", page: { ...mockReport.page, url: FAILED, finalUrl: FAILED } } });
    state = siteAuditStreamReducer(state, { type: "site:page-event", url: FAILED, index: 0, event: { type: "scores", scores: mockReport.scores, findings: mockReport.findings } });
    state = siteAuditStreamReducer(state, { type: "site:page-event", url: FAILED, index: 0, event: { type: "done" } });
    state = siteAuditStreamReducer(state, { type: "site:page-done", url: FAILED, index: 0, status: "ok" });
    state = siteAuditStreamReducer(state, { type: "site:rollup", rollup: { pagesAudited: 1, pagesFailed: 0, avgScores: null, worstPages: [], commonFindings: [] }, stoppedEarly: null });
    state = siteAuditStreamReducer(state, { type: "site:done" });

    expect(state.pages[GOOD]).toBe(good);
    expect(state.pages[FAILED]?.phase).toBe("done");
    expect(state.pageOrder).toEqual([GOOD, FAILED]);
    expect(state.rollup?.pagesAudited).toBe(2);
    expect(state.rollup?.pagesFailed).toBe(0);
    expect(state.retryingFailed).toBe(false);
  });

  it("retries a page the time budget never started (no state entry) and audits it to done", () => {
    const good = completedPage(GOOD, 0);
    const NEVER_STARTED = "https://example.test/never-started";
    const initial: SiteAuditStreamState = {
      ...INITIAL_SITE_AUDIT_STREAM_STATE,
      phase: "done",
      rootUrl: ROOT,
      method: "sitemap",
      discoveredPages: [{ url: GOOD, source: "sitemap" }, { url: NEVER_STARTED, source: "sitemap" }],
      pageOrder: [GOOD, NEVER_STARTED],
      // The budget expired before NEVER_STARTED got a site:page-start — no entry exists.
      pages: { [GOOD]: good },
      rollup: { pagesAudited: 1, pagesFailed: 1, avgScores: null, worstPages: [], commonFindings: [] },
      stoppedEarly: { reason: "budget", pagesRemaining: 1 },
    };

    let state = siteAuditStreamReducer(initial, { type: "retry-pages", urls: [NEVER_STARTED] });
    expect(state.pages[GOOD]).toBe(good);
    expect(state.retryingFailed).toBe(true);

    state = siteAuditStreamReducer(state, { type: "site:discovery-start", rootUrl: ROOT });
    state = siteAuditStreamReducer(state, {
      type: "site:discovery-done",
      rootUrl: ROOT,
      method: "retry",
      pages: [{ url: NEVER_STARTED, source: "retry" }],
      truncated: false,
    });
    state = siteAuditStreamReducer(state, { type: "site:page-start", url: NEVER_STARTED, index: 0, total: 1 });
    state = siteAuditStreamReducer(state, { type: "site:page-event", url: NEVER_STARTED, index: 0, event: { type: "meta", page: { ...mockReport.page, url: NEVER_STARTED, finalUrl: NEVER_STARTED } } });
    state = siteAuditStreamReducer(state, { type: "site:page-event", url: NEVER_STARTED, index: 0, event: { type: "scores", scores: mockReport.scores, findings: mockReport.findings } });
    state = siteAuditStreamReducer(state, { type: "site:page-event", url: NEVER_STARTED, index: 0, event: { type: "done" } });
    state = siteAuditStreamReducer(state, { type: "site:page-done", url: NEVER_STARTED, index: 0, status: "ok" });
    state = siteAuditStreamReducer(state, { type: "site:rollup", rollup: { pagesAudited: 1, pagesFailed: 0, avgScores: null, worstPages: [], commonFindings: [] }, stoppedEarly: null });
    state = siteAuditStreamReducer(state, { type: "site:done" });

    expect(state.pages[GOOD]).toBe(good);
    expect(state.pages[NEVER_STARTED]?.phase).toBe("done");
    expect(state.pageOrder).toEqual([GOOD, NEVER_STARTED]);
    expect(state.rollup?.pagesAudited).toBe(2);
    expect(state.rollup?.pagesFailed).toBe(0);
    expect(state.retryingFailed).toBe(false);
  });
});
