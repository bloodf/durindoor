// Keenable public (keyless) tier, selected explicitly for web search and fetch.
// Both endpoints are fixed official HTTPS origins; redirects are never followed.
export default {
  id: "keenable",
  alias: "keenable",
  display: {
    name: "Keenable",
    icon: "travel_explore",
    color: "#0F766E",
    textIcon: "KE",
    website: "https://keenable.ai"
  },
  category: "freeTier",
  authType: "none",
  serviceKinds: [
    "webSearch",
    "webFetch"
  ],
  noAuth: true,
  searchConfig: {
    baseUrl: "https://api.keenable.ai/v1/search/public",
    fixedBaseUrl: true,
    method: "POST",
    authType: "none",
    authHeader: "none",
    preventRedirects: true,
    costPerQuery: 0,
    searchTypes: [
      "web"
    ],
    defaultMaxResults: 5,
    maxMaxResults: 50,
    timeoutMs: 15000,
    cacheTTLMs: 180000
  },
  fetchConfig: {
    baseUrl: "https://api.keenable.ai/v1/fetch/public",
    method: "GET",
    authType: "none",
    authHeader: "none",
    preventRedirects: true,
    costPerQuery: 0,
    formats: [
      "markdown"
    ],
    maxCharacters: 100000,
    timeoutMs: 30000
  }
};
