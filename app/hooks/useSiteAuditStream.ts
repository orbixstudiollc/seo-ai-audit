"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import type {
  DiscoveredPageInfo,
  DiscoveryMethod,
  SiteAuditStreamEvent,
  SiteAuditStreamPhase,
  SiteErrorKind,
  SiteRollup,
  StoppedEarlyInfo,
} from "@/lib/audit/types";
import { parseSiteAuditFrame } from "@/lib/audit/stream";
import { computeSiteRollup } from "@/lib/audit/siteRollup";
import { auditStreamReducer, INITIAL_AUDIT_STREAM_STATE, type AuditStreamState } from "./useAuditStream";

/**
 * Site-crawl sibling of useAuditStream: streams POST /api/audit/bulk and
 * accumulates the wrapping site:* events, plus one full per-page
 * AuditStreamState per discovered page — built by feeding each page's
 * unwrapped `site:page-event.event` through the SAME auditStreamReducer
 * useAuditStream itself uses, so a page's drill-in view is byte-identical
 * data to what a direct /api/audit run would have produced.
 */

export interface PageRunState extends AuditStreamState {
  url: string;
  index: number;
}

export interface SiteAuditStreamState {
  phase: SiteAuditStreamPhase;
  rootUrl: string | null;
  method: DiscoveryMethod | null;
  discoveredPages: DiscoveredPageInfo[];
  truncated: boolean;
  /** Keyed by page URL. */
  pages: Record<string, PageRunState>;
  /** Discovery order — the order to render the page list in. */
  pageOrder: string[];
  rollup: SiteRollup | null;
  stoppedEarly: StoppedEarlyInfo | null;
  error: { kind: SiteErrorKind; message: string; retryAfter?: number } | null;
  retryingFailed?: boolean;
  retryPageUrls?: string[];
}

export const INITIAL_SITE_AUDIT_STREAM_STATE: SiteAuditStreamState = {
  phase: "idle",
  rootUrl: null,
  method: null,
  discoveredPages: [],
  truncated: false,
  pages: {},
  pageOrder: [],
  rollup: null,
  stoppedEarly: null,
  error: null,
  retryingFailed: false,
  retryPageUrls: [],
};

type LifecycleAction =
  | { type: "reset" }
  | { type: "streaming" }
  | { type: "retry-pages"; urls: string[] };
type SiteAuditAction = SiteAuditStreamEvent | LifecycleAction;

function combinedRollup(state: SiteAuditStreamState): SiteRollup {
  return computeSiteRollup(state.pageOrder.map((url) => {
    const page = state.pages[url];
    return {
      url,
      status: page?.phase === "done" && page.scores ? "ok" as const : "error" as const,
      page: page?.page ?? null,
      scores: page?.scores ?? null,
      findings: page?.findings ?? null,
    };
  }));
}

export function siteAuditStreamReducer(state: SiteAuditStreamState, action: SiteAuditAction): SiteAuditStreamState {
  switch (action.type) {
    case "reset":
      return { ...INITIAL_SITE_AUDIT_STREAM_STATE, phase: "connecting" };
    case "retry-pages": {
      const retryPages = new Set(action.urls);
      return {
        ...state,
        phase: "auditing",
        error: null,
        retryingFailed: true,
        retryPageUrls: action.urls,
        pages: Object.fromEntries(Object.entries(state.pages).map(([url, page]) => [
          url,
          retryPages.has(url) ? { ...page, phase: "connecting", error: null } : page,
        ])),
      };
    }
    case "streaming":
      // No dedicated wire phase for "HTTP OK, stream open" — the next real
      // event (site:discovery-start) flips phase to "discovering" almost
      // immediately, so "connecting" covers this gap too.
      return state;
    case "site:discovery-start":
      return { ...state, phase: state.retryingFailed ? "auditing" : "discovering", rootUrl: action.rootUrl };
    case "site:discovery-done":
      if (action.method === "retry") return { ...state, phase: "auditing" };
      return {
        ...state,
        method: action.method,
        discoveredPages: action.pages,
        truncated: action.truncated,
        pageOrder: action.pages.map((p) => p.url),
        phase: "auditing",
      };
    case "site:page-start":
      return {
        ...state,
        pages: {
          ...state.pages,
          [action.url]: { ...INITIAL_AUDIT_STREAM_STATE, phase: "streaming", url: action.url, index: action.index },
        },
      };
    case "site:page-event": {
      const prevPage: PageRunState =
        state.pages[action.url] ?? { ...INITIAL_AUDIT_STREAM_STATE, url: action.url, index: action.index };
      const nextPage: PageRunState = { ...auditStreamReducer(prevPage, action.event), url: action.url, index: action.index };
      return { ...state, pages: { ...state.pages, [action.url]: nextPage } };
    }
    case "site:page-done":
      return state; // the page's own done/error event already settled its phase
    case "site:rollup":
      return {
        ...state,
        rollup: state.retryingFailed ? combinedRollup(state) : action.rollup,
        stoppedEarly: action.stoppedEarly,
      };
    case "site:done":
      return { ...state, phase: "done", retryingFailed: false, retryPageUrls: [] };
    case "site:error": {
      const retryUrls = new Set(state.retryPageUrls ?? []);
      return {
        ...state,
        phase: "error",
        error: { kind: action.kind, message: action.message, retryAfter: action.retryAfter },
        retryingFailed: false,
        retryPageUrls: [],
        pages: state.retryingFailed
          ? Object.fromEntries(Object.entries(state.pages).map(([url, page]) => [
              url,
              retryUrls.has(url) && page.phase !== "done"
                ? { ...page, phase: "error", error: { kind: "server" as const, message: action.message } }
                : page,
            ]))
          : state.pages,
      };
    }
    default:
      return state;
  }
}

interface HttpErrorBody {
  error?: string;
  message?: string;
  retryAfter?: number;
}

function errorFromHttpStatus(status: number, body: HttpErrorBody | null): Extract<SiteAuditStreamEvent, { type: "site:error" }> {
  return {
    type: "site:error",
    kind: (body?.error as SiteErrorKind | undefined) ?? "server",
    message: body?.message ?? `Site audit request failed (${status}).`,
    retryAfter: body?.retryAfter,
  };
}

export interface UseSiteAuditStreamResult extends SiteAuditStreamState {
  retry: () => void;
  retryFailedPages: () => void;
}

export interface SiteAuditRequest {
  url: string;
  limit?: number;
  pages?: string[];
}

export async function consumeSiteAuditStream(
  request: SiteAuditRequest,
  signal: AbortSignal,
  onEvent: (event: SiteAuditStreamEvent) => void,
): Promise<void> {
  const res = await fetch("/api/audit/bulk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as HttpErrorBody | null;
    onEvent(errorFromHttpStatus(res.status, body));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseSiteAuditFrame(frame);
      if (event) {
        onEvent(event);
        if (event.type === "site:done" || event.type === "site:error") ended = true;
      }
      boundary = buffer.indexOf("\n\n");
    }
  }

  if (!ended) onEvent({ type: "site:error", kind: "server", message: "Connection dropped before the site audit finished." });
}

export function useSiteAuditStream(url: string, limit?: number): UseSiteAuditStreamResult {
  const [state, dispatch] = useReducer(siteAuditStreamReducer, INITIAL_SITE_AUDIT_STREAM_STATE);
  const [request, setRequest] = useState<{ kind: "full" | "failed"; pages?: string[]; attempt: number }>({ kind: "full", attempt: 0 });

  useEffect(() => {
    const controller = new AbortController();
    if (request.kind === "failed" && request.pages) dispatch({ type: "retry-pages", urls: request.pages });
    else dispatch({ type: "reset" });

    void (async () => {
      try {
        dispatch({ type: "streaming" });
        await consumeSiteAuditStream({
          url,
          ...(request.kind === "failed" ? { pages: request.pages } : limit !== undefined ? { limit } : {}),
        }, controller.signal, dispatch);
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        dispatch({
          type: "site:error",
          kind: "server",
          message: err instanceof Error ? err.message : "Site audit stream interrupted.",
        });
      }
    })();

    return () => controller.abort();
  }, [url, limit, request]);

  const retry = useCallback(() => setRequest((current) => ({ kind: "full", attempt: current.attempt + 1 })), []);
  const retryFailedPages = useCallback(() => {
    // Errored pages AND pages the wall-clock budget never started (no state entry).
    const pages = state.pageOrder.filter((pageUrl) => state.pages[pageUrl]?.phase !== "done");
    if (pages.length === 0 || state.retryingFailed || (state.phase !== "done" && state.phase !== "error")) return;
    setRequest((current) => ({ kind: "failed", pages, attempt: current.attempt + 1 }));
  }, [state.pageOrder, state.pages, state.phase, state.retryingFailed]);

  return { ...state, retry, retryFailedPages };
}
