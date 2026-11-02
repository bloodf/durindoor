export default {
  id: "unorouter",
  alias: "unorouter",
  display: {
    name: "UnoRouter",
    icon: "route",
    color: "#65A30D",
    textIcon: "UR",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.unorouter.com/v1/chat/completions",
    validateUrl: "https://api.unorouter.com/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.unorouter.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
