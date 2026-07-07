export default {
  id: "bai",
  alias: "bai",
  uiAlias: "bai",
  display: {
    name: "B.AI",
    icon: "router",
    color: "#111827",
    textIcon: "BAI",
    website: "https://b.ai",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.b.ai/v1/chat/completions",
    modelsUrl: "https://api.b.ai/v1/models",
    thinkingFormat: "openai",
  },
  models: [],
  modelsFetcher: { url: "https://api.b.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
