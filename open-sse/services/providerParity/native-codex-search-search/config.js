// OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT),
// open-sse/config/searchRegistry.ts `codex-search` entry + SEARCH_CREDENTIAL_FALLBACKS
// + SEARCH_PROVIDER_ALIASES, src/shared/constants/providers/search.ts `codex-search` catalog entry.
// Private staging metadata; no production registry imports this directory.
import codex from "../../../providers/registry/codex.js";

export const CODEX_SEARCH_ID = "codex-search";
/** Source request-only alias (`codex_search` -> `codex-search`). `codex` is deliberately NOT an alias. */
export const CODEX_SEARCH_ALIASES = Object.freeze(["codex_search"]);
/** Source SEARCH_CREDENTIAL_FALLBACKS: reuse connected Codex (ChatGPT) accounts; no separate key. */
export const CODEX_SEARCH_CREDENTIAL_PROVIDERS = Object.freeze(["codex"]);
export const CODEX_SEARCH_ORIGIN = "https://chatgpt.com";
export const CODEX_SEARCH_URL = `${CODEX_SEARCH_ORIGIN}/backend-api/codex/responses`;
/** Source resolveCodexSearchOptions default model. */
export const CODEX_SEARCH_DEFAULT_MODEL = "gpt-6-luna";
export const CODEX_SEARCH_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh"]);
/** Source timeRange values the instruction hint understands (local callers.js vocabulary). */
export const CODEX_SEARCH_TIME_RANGES = Object.freeze(["any", "day", "week", "month", "year"]);
/** Local wire identity, same pin the Codex executor uses (source getCodexBackendIdentityHeaders). */
export const CODEX_SEARCH_CLIENT_VERSION = codex.transport.cliVersion;
/** Codex search cooldown scope used by the local alpha-search handler; never the chat scope. */
export const CODEX_SEARCH_LOCK_KEY = "websearch:codex";

/**
 * Exact pinned registry fields, expressed in the local `searchConfig` shape.
 * `fixedBaseUrl`/`preventRedirects` are the local fixed-origin flags; the source
 * uses `redirect: "error"` and refuses caller base URLs for apikey providers.
 */
export const searchConfig = Object.freeze({
  baseUrl: CODEX_SEARCH_URL,
  fixedBaseUrl: true,
  method: "POST",
  authType: "apikey",
  authHeader: "bearer",
  preventRedirects: true,
  // Subscription quota, not a per-query API charge; the real cost is unknown.
  costPerQuery: 0,
  freeMonthlyQuota: 0,
  searchTypes: Object.freeze(["web", "news"]),
  defaultMaxResults: 5,
  maxMaxResults: 10,
  timeoutMs: 60_000,
  cacheTTLMs: 10 * 60 * 1000,
  fallbackOnly: true,
});

/** Source catalog entry (src/shared/constants/providers/search.ts). */
export const codexSearchProviderDefinition = Object.freeze({
  id: CODEX_SEARCH_ID,
  alias: "codex_search",
  display: Object.freeze({
    name: "Codex Web Search (ChatGPT)",
    icon: "search",
    color: "#10A37F",
    textIcon: "CS",
    website: "https://chatgpt.com",
    authHint:
      "Uses your connected OpenAI Codex (ChatGPT) accounts — no separate key. Each search spends Codex subscription quota (~10k input tokens) and takes ~10–40 s.",
  }),
  category: "apikey",
  authType: "apikey",
  credentialProviders: CODEX_SEARCH_CREDENTIAL_PROVIDERS,
  serviceKinds: Object.freeze(["webSearch"]),
  searchConfig,
});

/** Additive metadata for registration; never replaces the existing `codex` LLM transport/auth. */
export const codexSearchMetadata = Object.freeze({
  searchConfig,
  serviceKinds: Object.freeze(["webSearch"]),
  models: Object.freeze([]),
  defaultModel: CODEX_SEARCH_DEFAULT_MODEL,
});
