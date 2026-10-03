export default {
  id: "deepinfra",
  alias: "deepinfra",
  display: {
    name: "DeepInfra",
    icon: "memory",
    color: "#111827",
    textIcon: "DI",
    website: "https://deepinfra.com",
    notice: {
      apiKeyUrl: "https://deepinfra.com/dash/api_keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.deepinfra.com/v1/openai/chat/completions",
    authHeader: "bearer",
    validateUrl: "https://api.deepinfra.com/v1/openai/models",
    thinkingFormat: "openai",
  },
  // Public /models is complete and changes faster than a curated snapshot.
  models: [],
  modelsFetcher: { url: "https://api.deepinfra.com/v1/openai/models", type: "openai" },
  passthroughModels: true,
};
