export default {
  id: "requesty",
  alias: "requesty",
  display: {
    name: "Requesty",
    icon: "router",
    color: "#6366F1",
    textIcon: "RQ",
    website: "https://requesty.ai",
    notice: {
      text: "Free tier around 200 requests/day across a multi-model routing gateway.",
      apiKeyUrl: "https://app.requesty.ai",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://router.requesty.ai/v1/chat/completions",
    validateUrl: "https://router.requesty.ai/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://router.requesty.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
