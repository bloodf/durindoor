export default {
  id: "llmtr",
  alias: "lt",
  uiAlias: "lt",
  display: {
    name: "LLMTR",
    icon: "public",
    color: "#121E40",
    textIcon: "LT",
    website: "https://llmtr.com",
    notice: { apiKeyUrl: "https://llmtr.com/dashboard/api-keys" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://llmtr.com/v1/chat/completions",
    thinkingFormat: "llmtr",
    // /v1/models is public; an explicit connection test uses Chat Completions.
    probeUsesBaseUrl: true,
  },
  // Verified against the provider's public model documentation, 2026-11-20.
  models: [{ id: "llmtr/qwen3-8-27b", name: "LLMTR Qwen 3.8 27B", supportsReasoning: true, toolCalling: true }],
  passthroughModels: true,
};
