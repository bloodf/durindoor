// TeamoRouter's key-gated catalog is the source of model IDs. The seed stays
// empty so bare model ids keep resolving to their first-party providers.
export default {
  id: "teamorouter",
  alias: "teamorouter",
  display: {
    name: "TeamoRouter",
    icon: "hub",
    color: "#6D28D9",
    textIcon: "TR",
    website: "https://teamorouter.com",
    notice: {
      text: "OpenAI-compatible gateway. Models are discovered from your API key.",
      apiKeyUrl: "https://teamorouter.com/dashboard?tab=api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.teamorouter.com/v1/chat/completions",
    validateUrl: "https://api.teamorouter.com/v1/models",
    format: "openai",
  },
  serviceKinds: ["llm"],
  models: [],
  modelsFetcher: { url: "https://api.teamorouter.com/v1/models", type: "openai" },
  passthroughModels: true,
};
