/**
 * Typed failure for the URL import path. Every kind carries a user-facing
 * message that keeps the paste fallback honest — URL import is best-effort,
 * paste always works (plan "URL import blocked by target sites" risk row).
 */
export type ImportErrorKind =
  | "blocked"
  | "timeout"
  | "too_large"
  | "not_html"
  | "fetch_failed";

export class ImportError extends Error {
  readonly kind: ImportErrorKind;

  constructor(kind: ImportErrorKind, message: string) {
    super(message);
    this.name = "ImportError";
    this.kind = kind;
  }
}

export const PASTE_FALLBACK_MESSAGE =
  "Could not fetch this URL — paste the article text instead.";
