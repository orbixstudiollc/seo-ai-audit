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
};

type LifecycleAction = { type: "reset" } | { type: "streaming" };
type SiteAuditAction = SiteAuditStreamEvent | LifecycleAction;

export function siteAuditStreamReducer(state: SiteAuditStreamState, action: SiteAuditAction): SiteAuditStreamState {
  switch (action.type) {
    case "reset":
      return { ...INITIAL_SITE_AUDIT_STREAM_STATE, phase: "connecting" };
    case "streaming":
      // No dedicated wire phase for "HTTP OK, stream open" — the next real
      // event (site:discovery-start) flips phase to "discovering" almost
      // immediately, so "connecting" covers this gap too.
      return state;
    case "site:discovery-start":
      return { ...state, phase: "discovering", rootUrl: action.rootUrl };
    case "site:discovery-done":
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
      return { ...state, rollup: action.rollup, stoppedEarly: action.stoppedEarly };
    case "site:done":
      return { ...state, phase: "done" };
    case "site:error":
      return {
        ...state,
        phase: "error",
        error: { kind: action.kind, message: action.message, retryAfter: action.retryAfter },
      };
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
}

export function useSiteAuditStream(url: string, limit?: number): UseSiteAuditStreamResult {
  const [state, dispatch] = useReducer(siteAuditStreamReducer, INITIAL_SITE_AUDIT_STREAM_STATE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: "reset" });

    void (async () => {
      try {
        const res = await fetch("/api/audit/bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url, ...(limit !== undefined ? { limit } : {}) }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as HttpErrorBody | null;
          dispatch(errorFromHttpStatus(res.status, body));
          return;
        }

        dispatch({ type: "streaming" });

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
              dispatch(event);
              if (event.type === "site:done" || event.type === "site:error") ended = true;
            }
            boundary = buffer.indexOf("\n\n");
          }
        }

        if (!ended) {
          dispatch({ type: "site:error", kind: "server", message: "Connection dropped before the site audit finished." });
        }
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
  }, [url, limit, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, retry };
}
