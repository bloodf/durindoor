export default {
  id: "unifically",
  alias: "unifically",
  display: {
    name: "Unifically",
    icon: "route",
    color: "#0891B2",
    textIcon: "UF",
    notice: {
      text: "Chat models only; media models are not routed here.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.unifically.com/v1/chat/completions",
    validateUrl: "https://api.unifically.com/v1/models?category=llm",
  },
  models: [],
  modelsFetcher: { url: "https://api.unifically.com/v1/models?category=llm", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
