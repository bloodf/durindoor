// Token Harbor's authenticated catalog is the source of model IDs.
export default {
  id: "tokenharbor",
  alias: "tokenharbor",
  display: {
    name: "Token Harbor",
    icon: "hub",
    color: "#2563EB",
    textIcon: "TH",
    website: "https://tokenharbor.ai",
    notice: {
      text: "Use a Token Harbor Universal Key to discover and route available models.",
      apiKeyUrl: "https://tokenharbor.ai/dashboard/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://tokenharbor.ai/v1/chat/completions",
    validateUrl: "https://tokenharbor.ai/v1/models",
    format: "openai",
  },
  serviceKinds: ["llm"],
  models: [],
  modelsFetcher: { url: "https://tokenharbor.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
