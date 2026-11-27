// OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT),
// open-sse/config/searchRegistry.ts `duckduckgo-free` entry + SEARCH_PROVIDER_ALIASES
// (`duckduckgo: "duckduckgo-free"`), served by open-sse/handlers/search.ts
// tryDuckDuckGoFreeProvider -> open-sse/services/freeWebSearch.ts.
// Private staging metadata; no production registry imports this directory.
export const DDG_FREE_ID = "duckduckgo-free";
/** Source alias map entry only. `ddg`/`ddgw` stay owned by the local duckduckgo-web chat provider. */
export const DDG_FREE_ALIASES = Object.freeze(["duckduckgo"]);
export const DDG_LITE_ORIGIN = "https://lite.duckduckgo.com";
export const DDG_LITE_URL = `${DDG_LITE_ORIGIN}/lite/`;
/** Source freeWebSearch.ts DDG_USER_AGENT (the lite endpoint rejects obvious bot agents). */
export const DDG_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0 Safari/537.36";

/** Exact pinned searchRegistry.ts fields (registry key `duckduckgo-free`). */
export const searchConfig = Object.freeze({
  id: DDG_FREE_ID,
  name: "DuckDuckGo (free)",
  baseUrl: DDG_LITE_URL,
  method: "POST",
  authType: "none",
  authHeader: "none",
  costPerQuery: 0,
  freeMonthlyQuota: 999999,
  searchTypes: Object.freeze(["web"]),
  defaultMaxResults: 5,
  maxMaxResults: 25,
  timeoutMs: 10_000,
  cacheTTLMs: 5 * 60 * 1000,
  fallbackOnly: true,
});

/**
 * Missing local provider definition (no `duckduckgo-free` exists in
 * open-sse/providers/registry). Shaped like the local no-auth searxng entry;
 * serial registration copies this into a new registry file. There is no model
 * catalog and no dynamic discovery endpoint in the source.
 */
export const duckduckgoFreeProviderDefinition = Object.freeze({
  id: DDG_FREE_ID,
  alias: "duckduckgo",
  display: Object.freeze({
    name: "DuckDuckGo (free)",
    icon: "travel_explore",
    color: "#DE5833",
    textIcon: "DDG",
    website: "https://lite.duckduckgo.com/lite/",
  }),
  category: "freeTier",
  authType: "none",
  noAuth: true,
  serviceKinds: Object.freeze(["webSearch"]),
  searchConfig: Object.freeze((({ id: _id, name: _name, ...rest }) => rest)(searchConfig)),
});
