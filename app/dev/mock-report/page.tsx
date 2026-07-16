"use client";

import { notFound } from "next/navigation";
import { mockReport } from "@/lib/audit/mockReport";
import { AuditReportView } from "@/app/components/audit/AuditReportView";

/**
 * Development-only render target for WS3: the report's presentational layer
 * fed `mockReport` directly, bypassing `useAuditStream`/`/api/audit` entirely.
 * This is where the full report gets built, screenshotted, and axe-checked
 * before WS2's route exists. Gated out of production builds.
 */
export default function MockReportPage() {
  if (process.env.NODE_ENV !== "development") notFound();

  return (
    <AuditReportView
      phase="done"
      page={mockReport.page}
      signals={null}
      scores={mockReport.scores}
      findings={mockReport.findings}
      rewrites={mockReport.rewrites}
      error={null}
      onRetry={() => {}}
    />
  );
}
