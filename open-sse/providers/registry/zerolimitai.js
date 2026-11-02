export default {
  id: "zerolimitai",
  alias: "zerolimitai",
  display: {
    name: "ZeroLimit AI",
    icon: "route",
    color: "#111827",
    textIcon: "ZL",
    notice: {
      text: "Third-party gateway; review the provider's terms before use.",
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
