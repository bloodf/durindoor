export default {
  id: "uc-direct",
  alias: "ucd",
  display: {
    name: "UC Direct",
    icon: "route",
    color: "#DC2626",
    textIcon: "UC",
    notice: {
      text: "Metered uncensored.com Developer API that resells third-party models; authenticates with an X-API-Key (uai_sk_live_...) header. Review the provider's terms before use.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.uncensored.com/api/v1/chat/completions",
    validateUrl: "https://api.uncensored.com/api/v1/models",
    auth: { combined: true, header: "x-api-key", scheme: "raw" },
  },
  models: [],
  modelsFetcher: { url: "https://api.uncensored.com/api/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
