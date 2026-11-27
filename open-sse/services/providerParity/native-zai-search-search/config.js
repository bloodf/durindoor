// OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT),
// open-sse/config/searchRegistry.ts `zai-search` entry and SEARCH_CREDENTIAL_FALLBACKS.
// Private staging metadata; no production registry imports this directory.
// DurinDoor already folded this endpoint into the `glm` provider's searchConfig
// (upstream 9router refactor 9dbdca0e5e); see registration.json for the delta.
export const ZAI_SEARCH_ID = "zai-search";
export const ZAI_SEARCH_ALIASES = Object.freeze(["zai-search"]);
/** Connection providers whose stored API key may authorize this search (local owner first, then source fallback). */
export const ZAI_SEARCH_CREDENTIAL_PROVIDERS = Object.freeze(["glm", "zai"]);
export const ZAI_SEARCH_ORIGIN = "https://api.z.ai";
export const ZAI_SEARCH_MCP_URL = `${ZAI_SEARCH_ORIGIN}/api/mcp/web_search_prime/mcp`;
export const ZAI_SEARCH_TOOL = "web_search_prime";

/** Exact pinned registry fields. */
export const searchConfig = Object.freeze({
  id: ZAI_SEARCH_ID,
  name: "Z.AI Coding Plan Search",
  baseUrl: ZAI_SEARCH_MCP_URL,
  method: "POST",
  authType: "apikey",
  authHeader: "bearer",
  costPerQuery: 0,
  freeMonthlyQuota: 0,
  searchTypes: Object.freeze(["web"]),
  defaultMaxResults: 5,
  maxMaxResults: 50,
  timeoutMs: 10_000,
  cacheTTLMs: 5 * 60 * 1000,
});

/**
 * MCP Streamable HTTP client identity. The source uses @modelcontextprotocol/sdk
 * `Client({ name: "omniroute-search", version: "1.0" })`; DurinDoor sends its own name.
 * The requested protocol revision matches the local MCP gateway clients.
 */
export const MCP_CLIENT_INFO = Object.freeze({ name: "durindoor-search", version: "1.0" });
export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);

/** Total request deadline: the local search core's global budget, capped at 60 s. */
export const ZAI_SEARCH_TOTAL_TIMEOUT_MS = 15_000;
export const ZAI_SEARCH_MAX_TIMEOUT_MS = 60_000;

/** Additive metadata for the existing provider definition; never replaces transport/auth. */
export const zaiSearchMetadata = Object.freeze({
  searchConfig,
  serviceKinds: Object.freeze(["webSearch"]),
  models: Object.freeze([]),
  credentialProviders: ZAI_SEARCH_CREDENTIAL_PROVIDERS,
});
