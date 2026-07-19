import type { Metadata } from "next";
import { SavedReportClient } from "@/app/components/audit/SavedReportClient";

export const metadata: Metadata = {
  title: "Saved audit report",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ id: string }> };

export default async function SavedReportPage({ params }: PageProps) {
  const { id } = await params;
  let reportId = id;
  try { reportId = decodeURIComponent(id); } catch { /* Keep malformed IDs on the unavailable-report path. */ }
  return <SavedReportClient id={reportId} />;
}
