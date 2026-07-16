import { createHash } from "node:crypto";
import { canonicalize } from "./parse";

/** NUL joins the three hashed fields. Article prose, a rubric version tag,
 * and a model id string never contain a NUL byte, so (unlike a printable
 * separator such as a space) it can't be confused with real content and
 * cause two different (content, version, model) triples to hash the same. */
const FIELD_DELIMITER = String.fromCharCode(0);

/**
 * Cache key for a completed audit: sha256(NFC-normalized content) + rubric
 * version + model id, per the plan's reproducibility contract. A cache hit
 * on this key means "return the stored rubric results, zero API calls,
 * bit-identical" — so the key must change whenever any input that could
 * change the RUB scores changes (content, rubric prompt/schema version, or
 * the model producing the scores).
 *
 * `canonicalize` is applied here (not assumed pre-applied by the caller) so
 * this function is the single source of truth for "what content hash
 * means" — it's idempotent, so callers that already canonicalized are safe
 * too.
 */
export function cacheKey(canonicalContent: string, rubricVersion: string, modelId: string): string {
  const canonical = canonicalize(canonicalContent);
  return createHash("sha256")
    .update([canonical, rubricVersion, modelId].join(FIELD_DELIMITER))
    .digest("hex");
}
