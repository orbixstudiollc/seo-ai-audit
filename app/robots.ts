import type { MetadataRoute } from "next";

// Private, self-hosted BYOK dashboard — there is nothing public to crawl, so
// disallow everything. (No `sitemap` field: sitemap.ts was removed in the
// open-source pivot since there are no public marketing pages to map.)
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
