// OmniRoute #21068: OpenAI-compatible CrowLLM gateway with dynamic model discovery.
export default {
  id: "crowllm",
  alias: "crowllm",
  display: {
    name: "CrowLLM",
    icon: "route",
    color: "#10B981",
    textIcon: "CL",
    website: "https://crowllm.com",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://crowllm.com/v1/chat/completions",
    validateUrl: "https://crowllm.com/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://crowllm.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
