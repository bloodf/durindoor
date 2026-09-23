export default {
  id: "anysearch",
  alias: "anysearch",
  aliases: ["anysearch-search"],
  display: {
    name: "AnySearch",
    icon: "travel_explore",
    color: "#0D9488",
    textIcon: "AS",
    website: "https://anysearch.com",
    notice: {
      text: "Free public web search for AI agents. Free tier: 1,000 req/day.",
      apiKeyUrl: "https://anysearch.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasFree: true,
  serviceKinds: ["webSearch", "webFetch"],
  searchConfig: {
    baseUrl: "https://api.anysearch.com/v1/search",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    costPerQuery: 0,
    // Free tier is 1,000 req/day (daily reset, not monthly) — 0 here matches
    // the convention used for other daily-reset free tiers; the real figure
    // is in the notice text above.
    freeMonthlyQuota: 0,
    searchTypes: ["web"],
    defaultMaxResults: 5,
    maxMaxResults: 10,
    timeoutMs: 10000,
    cacheTTLMs: 300000,
  },
  fetchConfig: {
    baseUrl: "https://api.anysearch.com/v1/extract",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    costPerQuery: 0,
    freeMonthlyQuota: 0,
    formats: ["markdown", "text"],
    maxCharacters: 100000,
    timeoutMs: 15000,
  },
};
