// OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT),
// open-sse/config/searchRegistry.ts `kimi-search` entry + SEARCH_PROVIDER_ALIASES,
// src/shared/constants/providers/search.ts `kimi-search` catalog entry.
// Private staging metadata; no production registry imports this directory.
export const KIMI_SEARCH_ID = "kimi-search";
/**
 * Source search aliases (`kimi`, `moonshot` -> `kimi-search`). Locally `kimi` is
 * already the canonical LLM provider id (whose `searchViaChat` serves chat-wrapped
 * search), so only `moonshot` is safe to register as a new alias; see registration.json.
 */
export const KIMI_SEARCH_SOURCE_ALIASES = Object.freeze(["kimi", "moonshot"]);
export const KIMI_SEARCH_ALIASES = Object.freeze(["moonshot"]);
export const KIMI_SEARCH_ORIGIN = "https://api.moonshot.ai";
export const KIMI_SEARCH_URL = `${KIMI_SEARCH_ORIGIN}/v1/tools/search`;
export const KIMI_SEARCH_PRICING_URL = "https://platform.kimi.ai/docs/pricing/tools";

/**
 * Exact pinned registry fields, expressed in the local `searchConfig` shape.
 * `fixedBaseUrl`/`preventRedirects` are the local fixed-origin flags (see keenable.js);
 * the source has no caller base-URL override for this provider either.
 */
export const searchConfig = Object.freeze({
  baseUrl: KIMI_SEARCH_URL,
  fixedBaseUrl: true,
  method: "POST",
  authType: "apikey",
  authHeader: "bearer",
  preventRedirects: true,
  // $0.005 per successful non-empty call (source comment, platform.kimi.ai/docs/pricing/tools).
  costPerQuery: 0.005,
  freeMonthlyQuota: 0,
  searchTypes: Object.freeze(["web"]),
  defaultMaxResults: 5,
  maxMaxResults: 20,
  timeoutMs: 10_000,
  cacheTTLMs: 5 * 60 * 1000,
});

/** Source catalog entry (src/shared/constants/providers/search.ts). */
export const kimiSearchProviderDefinition = Object.freeze({
  id: KIMI_SEARCH_ID,
  alias: KIMI_SEARCH_ID,
  display: Object.freeze({
    name: "Kimi Search",
    icon: "search",
    color: "#2563EB",
    textIcon: "KM",
    website: "https://platform.kimi.ai/docs/api/tools-search",
    authHint: "Moonshot AI API key (MOONSHOT_API_KEY) from platform.kimi.ai",
  }),
  category: "apikey",
  authType: "apikey",
  serviceKinds: Object.freeze(["webSearch"]),
  searchConfig,
});

/** Additive metadata for registration; never replaces the existing `kimi` LLM transport/auth. */
export const kimiSearchMetadata = Object.freeze({
  searchConfig,
  serviceKinds: Object.freeze(["webSearch"]),
  models: Object.freeze([]),
});
