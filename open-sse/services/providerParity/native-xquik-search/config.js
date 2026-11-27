// OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT),
// open-sse/config/searchRegistry.ts `xquik-search` entry + SEARCH_PROVIDER_ALIASES,
// src/shared/constants/providers/search.ts `xquik-search` catalog entry,
// src/lib/providers/validation/searchProviders.ts `xquik-search` validator.
// Private staging metadata; no production registry imports this directory.
export const XQUIK_SEARCH_ID = "xquik-search";
/** Source SEARCH_PROVIDER_ALIASES (`xquik`, `xquik_search` -> `xquik-search`); neither collides locally. */
export const XQUIK_SEARCH_ALIASES = Object.freeze(["xquik", "xquik_search"]);
export const XQUIK_SEARCH_ORIGIN = "https://xquik.com";
export const XQUIK_SEARCH_PATH = "/api/v1/x/tweets/search";
export const XQUIK_SEARCH_URL = `${XQUIK_SEARCH_ORIGIN}${XQUIK_SEARCH_PATH}`;
/** Source accepted provider_options/providerSpecificData `queryType` values; anything else -> "Latest" in the source. */
export const XQUIK_QUERY_TYPES = Object.freeze(["Latest", "Top"]);
/** Source sinceTimeForRange durations (ms). */
const HOUR = 60 * 60 * 1000;
export const XQUIK_TIME_RANGES = Object.freeze({
  hour: HOUR, day: 24 * HOUR, week: 7 * 24 * HOUR, month: 30 * 24 * HOUR, year: 365 * 24 * HOUR,
});

/**
 * Exact pinned registry fields, expressed in the local `searchConfig` shape.
 * `fixedBaseUrl`/`preventRedirects` are the local fixed-origin flags (see keenable.js).
 * The source `fallbackOnly: true` keeps it out of automatic selection.
 */
export const searchConfig = Object.freeze({
  baseUrl: XQUIK_SEARCH_URL,
  fixedBaseUrl: true,
  method: "GET",
  authType: "apikey",
  authHeader: "x-api-key",
  preventRedirects: true,
  // Catalog estimate: metered per returned post, estimate uses 5 results (source authHint).
  costPerQuery: 0.00075,
  freeMonthlyQuota: 0,
  searchTypes: Object.freeze(["x"]),
  defaultMaxResults: 5,
  maxMaxResults: 20,
  timeoutMs: 15_000,
  cacheTTLMs: 5 * 60 * 1000,
  fallbackOnly: true,
});

/** Source catalog entry (src/shared/constants/providers/search.ts). */
export const xquikSearchProviderDefinition = Object.freeze({
  id: XQUIK_SEARCH_ID,
  alias: "xquik",
  display: Object.freeze({
    name: "Xquik X Search",
    icon: "tag",
    color: "#111827",
    textIcon: "XQ",
    website: "https://docs.xquik.com",
    authHint: "Xquik API key (xq_...). Search is metered per returned post; the catalog estimate uses 5 results.",
  }),
  category: "apikey",
  authType: "apikey",
  serviceKinds: Object.freeze(["webSearch"]),
  searchConfig,
});

/**
 * Source key validator (SEARCH_VALIDATOR_CONFIGS["xquik-search"]): GET search with q=test&limit=1.
 * Metadata only: this is a real (per-post metered) search, so nothing here calls it.
 */
export const xquikValidationProbe = Object.freeze({
  url: `${XQUIK_SEARCH_URL}?q=test&limit=1`,
  method: "GET",
  headerNames: Object.freeze(["Accept", "x-api-key"]),
  billable: true,
});

export const xquikSearchMetadata = Object.freeze({
  searchConfig,
  serviceKinds: Object.freeze(["webSearch"]),
  models: Object.freeze([]),
});
