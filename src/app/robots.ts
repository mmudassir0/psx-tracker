import type { MetadataRoute } from "next";

/**
 * Every page here is rendered per request from the database, so each crawler
 * hit costs database reads. Keep bots off the diagnostics page and API, and
 * ask polite ones to slow down across the ~500 symbol pages.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/health", "/api/", "/admin", "/account"],
      crawlDelay: 10,
    },
  };
}
