export default {
  id: "ofoxai",
  alias: "ofoxai",
  display: {
    name: "OfoxAI",
    icon: "route",
    color: "#EA580C",
    textIcon: "OF",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.ofox.ai/v1/chat/completions",
    validateUrl: "https://api.ofox.ai/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.ofox.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
