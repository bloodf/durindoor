// Chat and account-scoped discovery: https://daoxe.com/docs/en/start/quickstart
export default {
  id: "daoxe",
  alias: "daoxe",
  display: {
    name: "DaoXE",
    icon: "route",
    color: "#2563EB",
    textIcon: "DX",
    website: "https://daoxe.com",
    notice: { text: "Model availability depends on your API key's group. Discover models for this connection." },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.daoxe.com/v1/chat/completions",
    validateUrl: "https://api.daoxe.com/v1/models",
  },
  models: [
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "grok-4.5", name: "Grok 4.5" },
    { id: "grok-4.3", name: "Grok 4.3" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
  ],
  modelsFetcher: { url: "https://api.daoxe.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
