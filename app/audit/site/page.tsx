import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteAuditRunner } from "../../components/audit/SiteAuditRunner";

export const metadata: Metadata = {
  title: "Site audit results",
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

export default async function SiteAuditPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawUrl = typeof params.url === "string" ? params.url : undefined;
  const url = parseUrl(rawUrl);

  if (!url) {
    redirect("/");
  }

  return (
    <main className="flex flex-1 flex-col px-6 py-10 sm:py-14">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 pb-4">
        <Link href="/" className="w-fit font-mono text-xs uppercase tracking-wider text-text-3 hover:text-accent-ink">
          ← New audit
        </Link>
        <p className="break-all font-mono text-xs text-text-3">Auditing site {url}</p>
      </div>

      <SiteAuditRunner url={url} />
    </main>
  );
}
