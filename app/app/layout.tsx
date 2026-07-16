import type { ReactNode } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/app/components/SignOutButton";

// Authoritative gate for the whole dashboard. Middleware does a cheap Edge
// cookie check; this is the real one — an expired or forged session cookie has
// no valid server session and gets bounced to /login here.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-full flex-col bg-surface-0 font-sans text-text-1">
      <header className="sticky top-0 z-10 border-b border-line bg-surface-1/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3.5 md:px-8">
          <Link href="/app" className="group flex items-baseline gap-2">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 translate-y-px bg-accent-ink transition-transform group-hover:rotate-45"
            />
            <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.2em]">
              AEO/GEO Optimizer
            </span>
          </Link>

          <nav
            aria-label="Dashboard"
            className="flex items-center gap-5 font-mono text-[11px] uppercase tracking-[0.15em]"
          >
            <Link
              href="/app"
              className="text-text-2 underline-offset-4 transition-colors hover:text-text-1 hover:underline focus-visible:text-text-1 focus-visible:underline focus-visible:outline-none"
            >
              Documents
            </Link>
            <Link
              href="/app/settings"
              className="text-text-2 underline-offset-4 transition-colors hover:text-text-1 hover:underline focus-visible:text-text-1 focus-visible:underline focus-visible:outline-none"
            >
              Settings
            </Link>
            <span aria-hidden className="h-3.5 w-px bg-line-strong" />
            <SignOutButton />
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10 md:px-8 md:py-12">
        {children}
      </main>
    </div>
  );
}
