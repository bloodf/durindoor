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
  category: "apikey",
  authType: "optional",
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
