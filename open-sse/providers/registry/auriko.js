export default {
  id: "auriko",
  alias: "auriko",
  display: {
    name: "Auriko",
    icon: "route",
    color: "#CA8A04",
    textIcon: "AU",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.auriko.ai/v1/chat/completions",
    validateUrl: "https://api.auriko.ai/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.auriko.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
