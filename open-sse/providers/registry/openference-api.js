export default {
  id: "openference-api",
  alias: "ofa",
  display: {
    name: "Openference (API key)",
    icon: "route",
    color: "#0EA5E9",
    textIcon: "OP",
    website: "https://openference.com",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.openference.com/v1/chat/completions",
    validateUrl: "https://api.openference.com/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.openference.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
