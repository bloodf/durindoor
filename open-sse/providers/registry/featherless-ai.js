export default {
  id: "featherless-ai",
  alias: "featherless",
  display: {
    name: "Featherless AI",
    icon: "feather",
    color: "#7C3AED",
    textIcon: "FL",
    website: "https://featherless.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.featherless.ai/v1/chat/completions",
    authHeader: "bearer",
    validateUrl: "https://api.featherless.ai/v1/models",
    // Featherless serves community/vendor checkpoints (incl. QwQ, which
    // natively uses Qwen's <think> tag thinking) over a plain
    // OpenAI-compatible Chat Completions endpoint. Force openai thinking
    // format so reasoning controls serialize correctly instead of the
    // vendor-native "qwen" shape from capabilities.js pattern matching.
    thinkingFormat: "openai",
  },
  models: [
    { id: "featherless-ai/Qwerky-72B", name: "featherless-ai/Qwerky-72B" },
    { id: "featherless-ai/Qwerky-QwQ-32B", name: "featherless-ai/Qwerky-QwQ-32B" },
  ],
  modelsFetcher: { url: "https://api.featherless.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
