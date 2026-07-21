import { isSavedReport, type SavedAuditReport } from "@/lib/reports";
import { cloudHistoryConfigured, getSupabaseAdmin } from "./server";

export const SHARE_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/**
 * Resolve a public share token to its stored report. Server-only; the token
 * is the whole capability — no owner header involved (D-021).
 */
export async function loadSharedReport(token: string): Promise<SavedAuditReport | null> {
  if (!SHARE_TOKEN_PATTERN.test(token) || !cloudHistoryConfigured()) return null;
  const admin = getSupabaseAdmin();
  const { data: link, error: linkError } = await admin
    .from("share_links")
    .select("owner_hash,audit_id")
    .eq("token", token)
    .maybeSingle();
  if (linkError || !link) return null;
  const { data: report, error: reportError } = await admin
    .from("audit_reports")
    .select("payload")
    .eq("owner_hash", link.owner_hash)
    .eq("audit_id", link.audit_id)
    .maybeSingle();
  if (reportError) return null;
  const payload: unknown = report?.payload;
  return isSavedReport(payload) ? payload : null;
}
