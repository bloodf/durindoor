import { SITE_URL } from "@site/lib/site.js";
export default function robots() {
  return {
    rules: { userAgent: "*", allow: ["/", "/docs"], disallow: ["/dashboard", "/login", "/demo-preview", "/docs-search"] },
    sitemap: new URL("/sitemap.xml", SITE_URL).href,
  };
}
