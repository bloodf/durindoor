export default {
  id: "dit",
  alias: "dai",
  display: {
    name: "DIT.ai",
    icon: "route",
    color: "#0F766E",
    textIcon: "DA",
    website: "https://dit.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.dit.ai/v1/chat/completions",
    authHeader: "bearer",
    modelsUrl: "https://api.dit.ai/v1/models",
    defaultContextLength: 200000,
    // DIT is a marketplace router: it re-exposes claude-* model ids over a
    // plain OpenAI-compatible Chat Completions endpoint, not Anthropic's
    // native Messages API. Force openai thinking format so reasoning
    // controls (reasoning_effort) serialize correctly instead of the
    // claude-adaptive shape from capabilities.js's claude-sonnet-4-6 entry.
    thinkingFormat: "openai",
  },
  // Marketplace router: seed models are fallbacks while /v1/models is available.
  models: [
    { id: "gpt-5.4", name: "GPT-5.4 (DIT.ai)", contextLength: 400000, toolCalling: true, supportsReasoning: true, supportsVision: true },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (DIT.ai)", contextLength: 200000, toolCalling: true, supportsReasoning: true, supportsVision: true },
  ],
  modelsFetcher: { url: "https://api.dit.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
