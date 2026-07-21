import type { Metadata } from "next";
import { SiteHubClient } from "@/app/components/growth/SiteHubClient";

export const metadata: Metadata = {
  title: "Site hub",
  robots: { index: false, follow: false },
};

type PageProps = { params: Promise<{ host: string }> };

export default async function SiteHubPage({ params }: PageProps) {
  const { host } = await params;
  let hostname = host;
  try { hostname = decodeURIComponent(host); } catch { /* Keep the raw segment on malformed encoding. */ }
  return <SiteHubClient host={hostname} />;
}
