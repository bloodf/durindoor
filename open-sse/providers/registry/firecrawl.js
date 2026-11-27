export default {
  id: "firecrawl",
  alias: "firecrawl",
  display: {
    name: "Firecrawl",
    icon: "local_fire_department",
    color: "#F59E0B",
    textIcon: "FC",
    website: "https://firecrawl.dev",
    notice: {
      apiKeyUrl: "https://www.firecrawl.dev/app/api-keys"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "webFetch"
  ],
  fetchConfig: {
    baseUrl: "https://api.firecrawl.dev/v2/scrape",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    costPerQuery: 0.002,
    freeMonthlyQuota: 500,
    // Firecrawl /v2/scrape supports markdown and html (not plain text; upstream #5888).
    formats: [
      "markdown",
      "html"
    ],
    maxCharacters: 200000,
    timeoutMs: 30000
  }
};
