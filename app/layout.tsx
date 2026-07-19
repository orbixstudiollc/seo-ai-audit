import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppHeader } from "./components/AppHeader";
import { AccountProvider } from "./components/account/AccountProvider";
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
  "Paste a URL for an AI-search audit with AEO, GEO, citability, and AI Overview readiness scores. Start without signup; optionally sign in to recover reports across devices.";

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
        <AccountProvider>
          <AppHeader />
          <div className="flex flex-1 flex-col">{children}</div>
        </AccountProvider>
      </body>
    </html>
  );
}
