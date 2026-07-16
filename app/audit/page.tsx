import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "../components/ui/Card";

export const metadata: Metadata = {
  title: "Audit results",
  robots: { index: false },
};

function parseUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw.length > 2048) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return raw;
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AuditPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawUrl = typeof params.url === "string" ? params.url : undefined;
  const url = parseUrl(rawUrl);

  if (!url) {
    redirect("/");
  }

  return (
    <main className="flex flex-1 flex-col gap-6 px-6 py-10 sm:py-14">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Link href="/" className="w-fit font-mono text-xs uppercase tracking-wider text-text-3 hover:text-accent-ink">
            ← New audit
          </Link>
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-text-1 sm:text-3xl">
            Auditing
          </h1>
          <p className="break-all font-mono text-sm text-text-2">{url}</p>
        </div>

        {/* Mount point for the streamed results UI. Swap this Card for
            WS3's <AuditRunner url={url} /> once WS2's /api/audit and WS3's
            component land — everything above this line stays as-is. */}
        <Card label="Status">
          <div className="flex flex-col gap-2 p-6 text-sm text-text-2">
            <p>Audit engine wiring lands with WS2/WS3.</p>
            <p className="text-text-3">This page will stream live signal, score, and rewrite results here.</p>
          </div>
        </Card>
      </div>
    </main>
  );
}
