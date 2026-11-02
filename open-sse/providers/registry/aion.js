export default {
  id: "aion",
  alias: "aion",
  display: {
    name: "Aion Labs",
    icon: "route",
    color: "#0EA5E9",
    textIcon: "AI",
    website: "https://aionlabs.ai",
    notice: {
      text: "Free key from aionlabs.ai, 20k tokens/day on the free tier.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.aionlabs.ai/v1/chat/completions",
    validateUrl: "https://api.aionlabs.ai/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.aionlabs.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
