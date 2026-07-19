import { ImportError, PASTE_FALLBACK_MESSAGE } from "./errors";
import { assertSafeUrl, validateRedirectHop, type NodeFetchInit } from "./ssrfGuard";

/**
 * SSRF-guarded fetch for discovery (robots.txt / sitemap.xml / same-origin
 * link-crawl pages) — the same pinned-dispatcher + per-hop revalidation
 * policy as fetchArticle.ts, but content-type-agnostic and best-effort: a
 * missing sitemap or robots.txt is an ordinary 404 a caller inspects via
 * `status`, not a thrown error. fetchArticle.ts stays untouched (its
 * HTML-specific checks and typed-error contract are its own concern); this
 * is the smaller, generic sibling discovery needs.
 */

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 1 * 1024 * 1024; // sitemaps/robots/link pages: 1MB is generous
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  /** Body text, capped to maxBytes (silently truncated past the cap — discovery is best-effort). */
  text: string;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export async function safeFetchText(url: string, opts?: SafeFetchOptions): Promise<SafeFetchResult> {
  let { url: target, dispatcher } = await assertSafeUrl(url);

  const controller = new AbortController();
  const onExternalAbort = (): void => controller.abort(opts?.signal?.reason);
  if (opts?.signal) {
    if (opts.signal.aborted) onExternalAbort();
    else opts.signal.addEventListener("abort", onExternalAbort);
  }
  const timer = setTimeout(
    () => controller.abort(new ImportError("timeout", "Fetching this URL took too long.")),
    opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const fetchInit: NodeFetchInit = {
        redirect: "manual",
        signal: controller.signal,
        dispatcher,
        headers: { "user-agent": USER_AGENT, accept: "*/*", ...opts?.headers },
      };
      const res = await fetch(target, fetchInit);

      if (REDIRECT_STATUSES.has(res.status)) {
        await res.body?.cancel().catch(() => undefined);
        await dispatcher.close().catch(() => undefined);
        const location = res.headers.get("location");
        if (location === null) throw new ImportError("fetch_failed", PASTE_FALLBACK_MESSAGE);
        if (hop === MAX_REDIRECTS) {
          throw new ImportError("fetch_failed", "This URL redirected too many times.");
        }
        let next: string;
        try {
          next = new URL(location, target).toString();
        } catch {
          throw new ImportError("fetch_failed", PASTE_FALLBACK_MESSAGE);
        }
        ({ url: target, dispatcher } = await validateRedirectHop(next));
        continue;
      }

      const text = await readTextCapped(res, maxBytes);
      return {
        finalUrl: res.url !== "" ? res.url : target.toString(),
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        text,
      };
    }
    throw new ImportError("fetch_failed", PASTE_FALLBACK_MESSAGE);
  } catch (err) {
    throw err instanceof ImportError ? err : toTimeoutAwareError(err, controller.signal);
  } finally {
    clearTimeout(timer);
    if (opts?.signal) opts.signal.removeEventListener("abort", onExternalAbort);
    void dispatcher.close().catch(() => undefined);
  }
}

async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  if (res.body === null) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function toTimeoutAwareError(err: unknown, signal: AbortSignal): ImportError {
  if (signal.aborted && signal.reason instanceof ImportError) return signal.reason;
  return new ImportError("fetch_failed", PASTE_FALLBACK_MESSAGE);
}
