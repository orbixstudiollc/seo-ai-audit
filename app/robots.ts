import type { MetadataRoute } from "next";

// Public, anonymous audit tool: everything user-facing is crawlable. Only the
// API surface is disallowed (an SSE endpoint is useless to a crawler and each
// hit costs an audit run).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
  };
}
