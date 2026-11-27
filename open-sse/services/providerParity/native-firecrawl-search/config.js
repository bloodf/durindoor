// OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT),
// open-sse/config/searchRegistry.ts `firecrawl` entry, consumed by
// open-sse/handlers/search.ts through open-sse/handlers/search/firecrawlSearch.ts.
// Private staging metadata; no production registry imports this directory.
export const FIRECRAWL_ID = "firecrawl";
export const FIRECRAWL_ALIASES = Object.freeze(["firecrawl"]);
export const FIRECRAWL_ORIGIN = "https://api.firecrawl.dev";
export const FIRECRAWL_SEARCH_URL = `${FIRECRAWL_ORIGIN}/v2/search`;
export const FIRECRAWL_SEARCH_TYPES = Object.freeze(["web", "news"]);
export const FIRECRAWL_TIME_RANGES = Object.freeze({ day: "qdr:d", week: "qdr:w", month: "qdr:m", year: "qdr:y" });

/** Exact pinned registry entry (minus `id`/`name`, which the provider definition owns). */
export const searchConfig = Object.freeze({
  baseUrl: FIRECRAWL_SEARCH_URL,
  method: "POST",
  authType: "apikey",
  authHeader: "bearer",
  costPerQuery: 0.002,
  // 2 credits per started block of 10 returned results (source comment cites docs.firecrawl.dev/billing).
  resultBlockSize: 10,
  freeMonthlyQuota: 1000,
  searchTypes: FIRECRAWL_SEARCH_TYPES,
  defaultMaxResults: 5,
  maxMaxResults: 100,
  timeoutMs: 30_000,
  cacheTTLMs: 5 * 60 * 1000,
});

/** Additive metadata for the existing `firecrawl` provider; never replaces its fetchConfig/auth. */
export const firecrawlSearchMetadata = Object.freeze({
  searchConfig,
  serviceKinds: Object.freeze(["webSearch"]),
  models: Object.freeze([]),
});
