export default {
  id: "hackclub",
  priority: 70,
  alias: "hc",
  display: {
    name: "Hack Club AI",
    icon: "sparkles",
    color: "#EC3750",
    textIcon: "HC",
    website: "https://ai.hackclub.com",
  },
  // Requires a saved Bearer API key — NOT no-auth (PR #45 review). Hack Club's
  // proxy gates by key even though the underlying models are free to Hack Clubbers.
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://ai.hackclub.com/proxy/v1/chat/completions",
    validateUrl: "https://ai.hackclub.com/proxy/v1/models",
    authHeader: "bearer",
  },
  models: [
    { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
    { id: "mistralai/mistral-7b-instruct", name: "Mistral 7B" },
    { id: "deepseek-ai/deepseek-coder-33b", name: "DeepSeek Coder 33B" },
  ],
  serviceKinds: ["llm"],
  defaultContextLength: 128000,
  modelsFetcher: { url: "https://ai.hackclub.com/proxy/v1/models", type: "openai" },
  passthroughModels: true,
};
