export default {
  id: "fastrouter",
  alias: "fastrouter",
  display: {
    name: "FastRouter",
    icon: "route",
    color: "#F59E0B",
    textIcon: "FR",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.fastrouter.ai/api/v1/chat/completions",
    validateUrl: "https://api.fastrouter.ai/api/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.fastrouter.ai/api/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
