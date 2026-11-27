// OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT),
// open-sse/config/searchRegistry.ts `jina-search` entry, SEARCH_CREDENTIAL_FALLBACKS
// and SEARCH_PROVIDER_ALIASES. Private staging metadata; no production registry
// imports this directory.
export const JINA_SEARCH_ID = "jina-search";
/**
 * Request-only aliases from the source SEARCH_PROVIDER_ALIASES. They apply to
 * POST /v1/search routing only: locally `jina` already names the jina-ai
 * embedding provider, so registration must never remap it globally.
 */
export const JINA_SEARCH_REQUEST_ALIASES = Object.freeze(["jina-ai", "jina"]);
/** Source SEARCH_CREDENTIAL_FALLBACKS maps jina-search to jina-ai (same Bearer key as jina-reader). */
export const JINA_SEARCH_CREDENTIAL_FALLBACKS = Object.freeze(["jina-ai"]);
export const JINA_SEARCH_ORIGIN = "https://s.jina.ai";
/** Source buildJinaSearchRequest appends a trailing slash to baseUrl. */
export const JINA_SEARCH_URL = `${JINA_SEARCH_ORIGIN}/`;
export const JINA_SEARCH_DEFAULT_TIMEOUT_MS = 15_000;
export const JINA_SEARCH_MAX_TIMEOUT_MS = 60_000;

/** Exact pinned registry fields. */
export const searchConfig = Object.freeze({
  id: JINA_SEARCH_ID,
  name: "Jina Search (s.jina.ai)",
  baseUrl: JINA_SEARCH_ORIGIN,
  method: "POST",
  authType: "apikey",
  authHeader: "bearer",
  costPerQuery: 0.002,
  freeMonthlyQuota: 1000,
  searchTypes: Object.freeze(["web"]),
  defaultMaxResults: 5,
  maxMaxResults: 50,
  timeoutMs: JINA_SEARCH_DEFAULT_TIMEOUT_MS,
  cacheTTLMs: 5 * 60 * 1000,
});

/** Provider IS the model for webSearch; the source has no dynamic discovery for search providers. */
export const searchModels = Object.freeze([
  Object.freeze({ id: JINA_SEARCH_ID, name: "Jina Search (s.jina.ai)", kind: "webSearch" }),
]);

/** Additive provider definition for serial registration (no existing local provider uses this id). */
export const jinaSearchProviderDefinition = Object.freeze({
  id: JINA_SEARCH_ID,
  alias: JINA_SEARCH_ID,
  display: Object.freeze({
    name: "Jina Search",
    website: "https://jina.ai",
    notice: Object.freeze({ apiKeyUrl: "https://jina.ai/?sui=apikey" }),
  }),
  category: "apikey",
  authType: "apikey",
  serviceKinds: Object.freeze(["webSearch"]),
  searchConfig,
});
