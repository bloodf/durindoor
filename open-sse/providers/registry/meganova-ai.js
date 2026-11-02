export default {
  id: "meganova-ai",
  alias: "meganova-ai",
  display: {
    name: "MegaNova AI",
    icon: "route",
    color: "#2563EB",
    textIcon: "MN",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.meganova.ai/v1/chat/completions",
    validateUrl: "https://api.meganova.ai/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.meganova.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
