export default {
  id: "xkiro",
  alias: "xkiro",
  display: {
    name: "xKiro",
    icon: "route",
    color: "#EA580C",
    textIcon: "XK",
    notice: {
      text: "Third-party gateway; review the provider's terms before use.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.xkiro.com/v1/chat/completions",
    validateUrl: "https://api.xkiro.com/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.xkiro.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
