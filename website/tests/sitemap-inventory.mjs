import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";

// The production build writes this exact sitemap. Reading it at collection
// time lets Playwright schedule independent batches; every batch checks that
// the server actually serves the same inventory before auditing its routes.
export function sitemapRoutes(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]).pathname);
}

export const routes = sitemapRoutes(readFileSync(new URL("../.next/server/app/sitemap.xml.body", import.meta.url), "utf8"));
if (!routes.includes("/") || !routes.includes("/docs") || new Set(routes).size !== routes.length) {
  throw new Error("The built sitemap must contain unique public routes including / and /docs");
}
export const batches = Array.from({ length: Math.ceil(routes.length / 10) }, (_, index) => routes.slice(index * 10, index * 10 + 10));

export async function verifySitemap(request) {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  const served = sitemapRoutes(await response.text());
  expect(served).toEqual(routes);
  expect(served).toContain("/");
  expect(served).toContain("/docs");
  expect(new Set(served).size).toBe(served.length);
}
