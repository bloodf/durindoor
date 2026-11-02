export default {
  id: "freeinference",
  alias: "freeinference",
  display: {
    name: "FreeInference",
    icon: "route",
    color: "#10B981",
    textIcon: "FI",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://freeinference.org/v1/chat/completions",
    validateUrl: "https://freeinference.org/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://freeinference.org/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
