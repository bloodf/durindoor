export default {
  id: "eurouter",
  alias: "eurouter",
  display: {
    name: "EUrouter",
    icon: "route",
    color: "#1D4ED8",
    textIcon: "EU",
    notice: {
      text: "EU-hosted router.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.eurouter.ai/v1/chat/completions",
    validateUrl: "https://api.eurouter.ai/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.eurouter.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
