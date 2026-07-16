import { ImportError, PASTE_FALLBACK_MESSAGE } from "./errors";
import { assertSafeUrl, validateRedirectHop } from "./ssrfGuard";

/**
 * Best-effort article fetcher. Redirects are followed MANUALLY (max 3 hops)
 * with the SSRF guard re-run on every hop, the response is streamed with a
 * byte cap, and everything runs under one abort-signal timeout. Any failure
 * surfaces as an ImportError whose message points the user at the paste
 * fallback.
 */

const MAX_REDIRECTS = 3;
const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const DEFAULT_TIMEOUT_MS = 10_000;
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const HTML_CONTENT_TYPE_RE = /text\/html|application\/xhtml\+xml/i;

// A normal browser UA — some sites hard-block obvious bots.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const TOO_LARGE_MESSAGE =
  "This page is larger than 2MB — paste the article text instead.";

export interface FetchedArticle {
  title: string;
  html: string;
  finalUrl: string;
}

export async function fetchArticle(
  url: string,
  opts?: { timeoutMs?: number }, // test seam only; production callers omit it
): Promise<FetchedArticle> {
  let target = await assertSafeUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new ImportError(
          "timeout",
          "Fetching this URL took too long — paste the article text instead.",
        ),
      ),
    opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(target, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "accept-language": "en",
        },
      });

      if (REDIRECT_STATUSES.has(res.status)) {
        await res.body?.cancel().catch(() => undefined);
        const location = res.headers.get("location");
        if (location === null) {
          throw new ImportError("fetch_failed", PASTE_FALLBACK_MESSAGE);
        }
        if (hop === MAX_REDIRECTS) {
          throw new ImportError(
            "fetch_failed",
            "This URL redirected too many times — paste the article text instead.",
          );
        }
        let next: string;
        try {
          next = new URL(location, target).toString();
        } catch {
          throw new ImportError("fetch_failed", PASTE_FALLBACK_MESSAGE);
        }
        target = await validateRedirectHop(next);
        continue;
      }

      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new ImportError(
          "fetch_failed",
          `This URL responded with HTTP ${res.status} — paste the article text instead.`,
        );
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!HTML_CONTENT_TYPE_RE.test(contentType)) {
        await res.body?.cancel().catch(() => undefined);
        throw new ImportError(
          "not_html",
          "This URL isn't an HTML page — paste the article text instead.",
        );
      }

      const declaredLength = Number(res.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
        await res.body?.cancel().catch(() => undefined);
        throw new ImportError("too_large", TOO_LARGE_MESSAGE);
      }

      const html = await readBodyCapped(res, controller);
      return {
        title: extractTitle(html),
        html,
        finalUrl: res.url !== "" ? res.url : target.toString(),
      };
    }
    // Loop always returns or throws; this satisfies the type checker.
    throw new ImportError("fetch_failed", PASTE_FALLBACK_MESSAGE);
  } catch (err) {
    throw toImportError(err, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Stream the body with a byte counter; abort + throw past the 2MB cap. */
async function readBodyCapped(res: Response, controller: AbortController): Promise<string> {
  if (res.body === null) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let received = 0;
  let html = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    received += value.byteLength;
    if (received > MAX_BYTES) {
      const err = new ImportError("too_large", TOO_LARGE_MESSAGE);
      controller.abort(err);
      await reader.cancel().catch(() => undefined);
      throw err;
    }
    html += decoder.decode(value, { stream: true });
  }
  return html + decoder.decode();
}

function toImportError(err: unknown, signal: AbortSignal): ImportError {
  if (err instanceof ImportError) return err;
  // fetch/body reads reject with the abort reason we set (timeout / size cap).
  if (signal.aborted && signal.reason instanceof ImportError) return signal.reason;
  return new ImportError("fetch_failed", PASTE_FALLBACK_MESSAGE);
}

function extractTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const raw = match?.[1];
  if (raw === undefined) return "";
  return decodeBasicEntities(raw).replace(/\s+/g, " ").trim();
}

/** ponytail: the 5 named entities that matter for a <title>; extract.ts owns real decoding. */
function decodeBasicEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'");
}
