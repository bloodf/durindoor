export default {
  id: "poixe-ai",
  alias: "poixe-ai",
  display: {
    name: "Poixe AI",
    icon: "route",
    color: "#DB2777",
    textIcon: "PX",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.poixe.com/v1/chat/completions",
    validateUrl: "https://api.poixe.com/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.poixe.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
