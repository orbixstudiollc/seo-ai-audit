import type { NextConfig } from "next";

// ponytail: 'unsafe-inline' on script-src/style-src is a deliberate tradeoff,
// not an oversight. Next.js's App Router streams RSC payloads via inline
// <script> tags at hydration time, and several components use inline
// style={{}} attributes for CSS custom properties — both need a nonce-based
// CSP (middleware.ts minting a per-request nonce) to lock down without
// 'unsafe-inline'. This app is deliberately middleware-free (stateless,
// no auth) — add nonce middleware if that tradeoff ever needs revisiting.
// React's dev-mode debugging (component stack reconstruction) needs eval();
// production never calls it. Scoped to dev/test only so prod CSP stays strict.
const scriptSrc = ["'self'", "'unsafe-inline'", ...(process.env.NODE_ENV === "production" ? [] : ["'unsafe-eval'"])];

const CSP = [
  "default-src 'self'",
  `script-src ${scriptSrc.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // @aeo/scoring is a TypeScript-source workspace package (no build step); Next must transpile it.
  transpilePackages: ["@aeo/scoring"],
  // This workspace lives inside a larger monorepo-style tree with sibling lockfiles;
  // pin the workspace root so Turbopack stops inferring the wrong one.
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
