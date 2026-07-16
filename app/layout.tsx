import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://seo-ai-audit-pied.vercel.app";
const SITE_DESCRIPTION =
  "Paste a URL, get a free AI-search audit: AEO, GEO, citability, and AI Overview readiness scores with evidence-backed findings. No account, no signup.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "SEO AI Audit — free AI-search readiness audit",
    template: "%s — SEO AI Audit",
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "SEO AI Audit",
    title: "SEO AI Audit — free AI-search readiness audit",
    description: SITE_DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "SEO AI Audit — free AI-search readiness audit",
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line px-6 py-4">
          <nav aria-label="Main navigation">
            <Link
              href="/"
              className="font-mono text-sm font-semibold uppercase tracking-[0.16em] text-text-1 hover:text-accent-ink"
            >
              SEO AI Audit
            </Link>
          </nav>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
