export default {
  id: "literouter",
  alias: "literouter",
  display: {
    name: "LiteRouter",
    icon: "route",
    color: "#14B8A6",
    textIcon: "LR",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.literouter.com/v1/chat/completions",
    validateUrl: "https://api.literouter.com/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.literouter.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
