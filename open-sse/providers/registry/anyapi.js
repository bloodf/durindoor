export default {
  id: "anyapi",
  alias: "anyapi",
  display: {
    name: "AnyAPI",
    icon: "route",
    color: "#475569",
    textIcon: "AA",
    notice: {
      text: "Third-party OpenAI-compatible aggregator; pricing and free tier are unverified.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.anyapi.ai/v1/chat/completions",
    validateUrl: "https://api.anyapi.ai/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.anyapi.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
