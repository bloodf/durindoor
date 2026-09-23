export default {
  id: "context7",
  alias: "context7",
  aliases: ["ctx7", "c7"],
  display: {
    name: "Context7",
    icon: "menu_book",
    color: "#6B4FBB",
    textIcon: "C7",
    website: "https://context7.com",
    notice: {
      text: "Context7 library documentation search and fetch. API key is optional for the anonymous tier.",
      apiKeyUrl: "https://context7.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasFree: true,
  serviceKinds: ["webSearch", "webFetch"],
  // authType "none": the anonymous tier answers with no key (rate-limited,
  // not blocked); a configured ctx7sk-* key rides as a Bearer and raises the
  // quota — handled as an optional token by callers.js/handleFetchCore, not
  // as a hard-required credential.
  searchConfig: {
    baseUrl: "https://context7.com/api/v1",
    method: "GET",
    authType: "none",
    authHeader: "bearer",
    costPerQuery: 0,
    freeMonthlyQuota: 999999,
    searchTypes: ["web"],
    defaultMaxResults: 5,
    maxMaxResults: 20,
    timeoutMs: 10000,
    cacheTTLMs: 300000,
  },
  fetchConfig: {
    baseUrl: "https://context7.com/api/v1",
    method: "GET",
    authType: "none",
    authHeader: "bearer",
    costPerQuery: 0,
    freeMonthlyQuota: 999999,
    formats: ["markdown"],
    maxCharacters: 200000,
    timeoutMs: 15000,
  },
};
