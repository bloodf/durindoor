export default {
  id: "zerolimitai",
  alias: "zerolimitai",
  display: {
    name: "ZeroLimit AI",
    icon: "route",
    color: "#6366F1",
    textIcon: "ZL",
    website: "https://www.zerolimitai.com",
    notice: {
      text: "Models are accepted by id and discovered via /api/v1/models; requires account API key.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://www.zerolimitai.com/api/v1/chat/completions",
    validateUrl: "https://www.zerolimitai.com/api/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://www.zerolimitai.com/api/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
