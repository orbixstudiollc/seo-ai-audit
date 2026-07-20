import type { Metadata } from "next";
import Link from "next/link";
import { DashboardClient } from "../components/DashboardClient";
import { GrowthOverview } from "../components/growth/GrowthOverview";

export const metadata: Metadata = { title: "Dashboard" };

const TABS = [
  { id: "growth", label: "Growth", href: "/dashboard" },
  { id: "history", label: "History", href: "/dashboard?tab=history" },
] as const;

// Tab state lives in the URL (?tab=history) so views are shareable and
// back/forward works; no client state needed for the switch itself.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active = tab === "history" ? "history" : "growth";

  return (
    <>
      <nav
        aria-label="Dashboard sections"
        className="mx-auto -mb-2 flex w-full max-w-6xl gap-1 px-4 pt-6 sm:px-6"
      >
        {TABS.map(({ id, label, href }) => (
          <Link
            key={id}
            href={href}
            aria-current={active === id ? "page" : undefined}
            className={`border-b-2 px-3 pb-2 font-mono text-xs font-semibold uppercase tracking-wider ${
              active === id
                ? "border-accent-ink text-text-1"
                : "border-transparent text-text-3 hover:text-text-1"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {active === "growth" ? <GrowthOverview /> : <DashboardClient />}
    </>
  );
}
