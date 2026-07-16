import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @aeo/scoring is a TypeScript-source workspace package (no build step); Next must transpile it.
  transpilePackages: ["@aeo/scoring"],
  // This workspace lives inside a larger monorepo-style tree with sibling lockfiles;
  // pin the workspace root so Turbopack stops inferring the wrong one.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
