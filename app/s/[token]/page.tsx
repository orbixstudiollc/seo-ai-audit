import type { Metadata } from "next";
import Link from "next/link";
import { loadSharedReport } from "@/lib/cloud/share";
import { SharedReportView } from "@/app/components/audit/SharedReportView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared audit report",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ token: string }> };

export default async function SharedReportPage({ params }: PageProps) {
  const { token } = await params;
  const report = await loadSharedReport(token);

  if (!report) {
    return (
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
        <p className="font-mono text-xs uppercase tracking-wider text-text-3">Shared report</p>
        <h1 className="mt-2 text-2xl font-semibold">Link unavailable</h1>
        <p className="mt-3 text-sm text-text-2">
          This share link is invalid, was revoked by its owner, or the report no longer exists.
        </p>
        <Link href="/" className="mt-5 inline-block font-mono text-xs uppercase tracking-wider text-accent-ink hover:underline">
          ← Run your own audit
        </Link>
      </main>
    );
  }

  return <SharedReportView report={report} />;
}
