// The public external-client gateway; the older OAuth contract is unverified.
export default {
  id: "megabrain",
  alias: "mb",
  uiAlias: "mb",
  display: {
    name: "MegaBrain",
    icon: "neurology",
    color: "#6366F1",
    textIcon: "MB",
    website: "https://getmegabrain.com",
    notice: { apiKeyUrl: "https://getmegabrain.com/keys" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://getmegabrain.com/api/gateway/v1/chat/completions",
    validateUrl: "https://getmegabrain.com/api/gateway/v1/models",
    thinkingFormat: "openai",
  },
  models: [],
  modelsFetcher: { url: "https://getmegabrain.com/api/gateway/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
