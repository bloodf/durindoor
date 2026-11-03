export default {
  id: "onomeo",
  alias: "onomeo",
  display: {
    name: "Onomeo",
    icon: "route",
    color: "#059669",
    textIcon: "ON",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://onomeo.com/v1/chat/completions",
    validateUrl: "https://onomeo.com/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://onomeo.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
