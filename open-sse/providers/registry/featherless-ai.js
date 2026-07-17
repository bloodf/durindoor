export default {
  id: "featherless-ai",
  priority: 65,
  alias: "featherless",
  aliases: [
    "fl",
  ],
  uiAlias: "fl",
  display: {
    name: "Featherless AI",
    icon: "flutter_dash",
    color: "#7C3AED",
    textIcon: "FL",
    website: "https://featherless.ai",
    notice: {
      apiKeyUrl: "https://featherless.ai/account/api-keys",
    },
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
    // Curated presets ported from upstream 9router 0d4d4bc26 (folded into
    // featherless-ai to avoid the colliding id:"featherless" upstream added).
    { id: "deepseek-ai/DeepSeek-V4-Pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-ai/DeepSeek-V4-Flash", name: "DeepSeek V4 Flash" },
    { id: "zai-org/GLM-5.2", name: "GLM 5.2" },
    { id: "zai-org/GLM-5.1", name: "GLM 5.1" },
    { id: "moonshotai/Kimi-K2.7-Code", name: "Kimi K2.7 Code" },
    { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6" },
    { id: "moonshotai/Kimi-K2.5", name: "Kimi K2.5" },
  ],
  modelsFetcher: { url: "https://api.featherless.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
