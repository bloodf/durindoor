export default {
  id: "llmgateway",
  alias: "llmgateway",
  display: {
    name: "LLM Gateway",
    icon: "route",
    color: "#0F172A",
    textIcon: "LG",
    website: "https://llmgateway.io",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.llmgateway.io/v1/chat/completions",
    validateUrl: "https://api.llmgateway.io/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.llmgateway.io/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
