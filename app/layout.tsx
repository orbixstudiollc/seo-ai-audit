import type { Metadata } from "next";
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

// Private self-hosted app: a plain title, no OG/Twitter/marketing metadata
// (the landing page was removed in the open-source pivot). `robots.ts`
// disallows crawlers, so social preview cards would never be fetched anyway.
export const metadata: Metadata = {
  title: {
    default: "AEO/GEO Optimizer",
    template: "%s — AEO/GEO Optimizer",
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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
