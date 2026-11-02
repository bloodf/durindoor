export default {
  id: "lyceum",
  alias: "lyceum",
  display: {
    name: "Lyceum",
    icon: "route",
    color: "#BE185D",
    textIcon: "LY",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.lyceum.technology/openai/v1/chat/completions",
    validateUrl: "https://api.lyceum.technology/openai/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.lyceum.technology/openai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
