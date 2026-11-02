export default {
  id: "openference-api",
  alias: "ofa",
  display: {
    name: "Openference (API key)",
    icon: "route",
    color: "#0EA5E9",
    textIcon: "OP",
    website: "https://openference.com",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.openference.com/v1/chat/completions",
    validateUrl: "https://api.openference.com/v1/models",
  },
  models: [
    { id: "GLM-5.2", name: "GLM 5.2", contextLength: 850000 },
    { id: "Qwen3.8 27b", name: "Qwen3.8 27B", contextLength: 262144 },
    { id: "Llama 3.2 3B", name: "Llama 3.2 3B", contextLength: 131072 },
  ],
  modelsFetcher: { url: "https://api.openference.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
