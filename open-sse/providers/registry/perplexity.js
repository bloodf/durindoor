export default {
  id: "perplexity",
  priority: 180,
  alias: "perplexity",
  aliases: [
    "pplx",
    "perplexity-search",
  ],
  uiAlias: "pplx",
  display: {
    name: "Perplexity",
    icon: "search",
    color: "#20808D",
    textIcon: "PP",
    website: "https://www.perplexity.ai",
    notice: {
      apiKeyUrl: "https://www.perplexity.ai/settings/api",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.perplexity.ai/chat/completions",
    validateUrl: "https://api.perplexity.ai/models",
  },
  models: [
    { id: "sonar-pro", name: "Sonar Pro" },
    { id: "sonar", name: "Sonar" },
  ],
  serviceKinds: ["llm","webSearch"],
  searchConfig: {
    baseUrl: "https://api.perplexity.ai/search",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    costPerQuery: 0.005,
    freeMonthlyQuota: 0,
    searchTypes: ["web"],
    defaultMaxResults: 5,
    maxMaxResults: 20,
    timeoutMs: 10000,
    cacheTTLMs: 300000,
  },
  searchViaChat: {
    defaultModel: "sonar",
    endpoint: "https://api.perplexity.ai/chat/completions",
    pricingUrl: "https://docs.perplexity.ai/guides/pricing",
  },
};
