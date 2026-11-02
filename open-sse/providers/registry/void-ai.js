export default {
  id: "void-ai",
  alias: "void-ai",
  display: {
    name: "Void AI",
    icon: "route",
    color: "#475569",
    textIcon: "VA",
    notice: {
      text: "Aggregator; verify upstream terms.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.voidai.app/v1/chat/completions",
    validateUrl: "https://api.voidai.app/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.voidai.app/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
