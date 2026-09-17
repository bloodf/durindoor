export default {
  id: "tokenmarket",
  alias: "tokenmarket",
  aliases: ["tm"],
  uiAlias: "tokenmarket",
  display: {
    name: "Token Market",
    icon: "hub",
    color: "#2563EB",
    textIcon: "TM",
    website: "https://www.tokensmarket.ai",
    notice: {
      text: "OpenAI-compatible gateway with smart routing across leading AI models.",
      apiKeyUrl: "https://www.tokensmarket.ai/console",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  thinkingConfig: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: "https://api.tokensmarket.ai/v1/chat/completions",
    validateUrl: "https://api.tokensmarket.ai/v1/models",
    // Token Market exposes a boolean thinking switch rather than the portable
    // effort levels the `openai` format emits — see thinkingUnified.js.
    thinkingFormat: "tokenmarket",
  },
  serviceKinds: ["llm"],
  // Seed catalog for first-run discovery only. The authenticated /v1/models
  // endpoint stays authoritative, and passthroughModels keeps ids added
  // upstream usable without a registry change here.
  models: [
    { id: "claude-fable-5", name: "Claude Fable 5" },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  ],
  // Fork convention: the generic modelsFetcher path in
  // src/app/api/providers/[id]/models/route.js covers this, so no hardcoded
  // PROVIDER_MODELS_CONFIG entry is needed.
  modelsFetcher: { url: "https://api.tokensmarket.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
