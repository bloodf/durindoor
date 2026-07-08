export default {
  id: "qiniu",
  alias: "qiniu",
  display: {
    name: "Qiniu",
    icon: "cloud",
    color: "#1E88E5",
    textIcon: "QN",
    website: "https://www.qiniu.com",
    notice: {
      text: "Create a Qiniu AI inference API key, then use the OpenAI-compatible endpoint that proxies DeepSeek, Claude, Kimi, and more.",
      apiKeyUrl: "https://portal.qiniu.com/ai-inference/api-key",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.qnaigc.com/v1/chat/completions",
    validateUrl: "https://api.qnaigc.com/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api.qnaigc.com/v1/models", type: "openai" },
  passthroughModels: true,
  defaultContextLength: 128000,
};
