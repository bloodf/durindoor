export default {
  id: "mixlayer",
  alias: "mixlayer",
  display: {
    name: "Mixlayer",
    icon: "route",
    color: "#7C3AED",
    textIcon: "MX",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://models.mixlayer.ai/v1/chat/completions",
    validateUrl: "https://models.mixlayer.ai/v1/models",
  },
  models: [
    { id: "qwen/qwen3.5-4b-free", name: "Qwen 3.5 4B (free)" },
  ],
  modelsFetcher: { url: "https://models.mixlayer.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
