export default {
  id: "tokenrouter",
  alias: "trk",
  uiAlias: "trk",
  display: {
    name: "TokenRouter",
    icon: "hub",
    color: "#F59E0B",
    textIcon: "TK",
    website: "https://tokenrouter.com",
    notice: {
      text: "Free tier includes the MiniMax 3 model. Fully OpenAI-compatible with a working /v1/models catalog.",
      apiKeyUrl: "https://tokenrouter.com",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.tokenrouter.com/v1/chat/completions",
    validateUrl: "https://api.tokenrouter.com/v1/models",
    // TokenRouter is a plain OpenAI-compatible gateway; force openai
    // reasoning_effort format so DeepSeek-family reasoning requests don't
    // carry the DeepSeek-native `thinking` field the gateway rejects.
    thinkingFormat: "openai",
  },
  // Seed snapshot from upstream live /v1/models (decolua/9router@6efb9790),
  // pruned to flagship/newest models. Fork keeps the free-tier `minimax-3`
  // entry (referenced by the display notice above) and carries its enriched
  // DeepSeek metadata onto the namespaced upstream ids. Latest catalogue is
  // fetched via modelsFetcher; other ids still accepted via passthroughModels.
  models: [
    { id: "minimax-3", name: "MiniMax 3 (free, TokenRouter)", contextLength: 128000, toolCalling: true },
    { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5" },
    { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "anthropic/claude-opus-4.8", name: "Claude Opus 4.8" },
    { id: "anthropic/claude-opus-4.8-fast", name: "Claude Opus 4.8 Fast" },
    { id: "openai/gpt-5.4", name: "Gpt 5.4" },
    { id: "openai/gpt-5.4-mini", name: "Gpt 5.4 Mini" },
    { id: "openai/gpt-5.4-pro", name: "Gpt 5.4 Pro" },
    { id: "openai/gpt-5.5", name: "Gpt 5.5" },
    { id: "openai/gpt-5.6-sol", name: "Gpt 5.6 Sol" },
    { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash" },
    { id: "google/gemini-3.6-flash", name: "Gemini 3.6 Flash" },
    { id: "deepseek/deepseek-v4-flash", name: "Deepseek V4 Flash", contextLength: 163840, toolCalling: true, supportsReasoning: true },
    { id: "deepseek/deepseek-v4-pro", name: "Deepseek V4 Pro", contextLength: 163840, toolCalling: true, supportsReasoning: true },
    { id: "qwen/qwen3-coder-next", name: "Qwen3 Coder Next" },
    { id: "qwen/qwen3.7-max", name: "Qwen3.7 Max" },
    { id: "qwen/qwen3.8-max", name: "Qwen3.8 Max" },
    { id: "moonshotai/kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "moonshotai/kimi-k3-free", name: "Kimi K3 Free" },
    { id: "z-ai/glm-5.3-free", name: "Glm 5.3 Free" },
    { id: "z-ai/glm-5.2", name: "Glm 5.2" },
    { id: "z-ai/glm-5-turbo", name: "Glm 5 Turbo" },
    { id: "x-ai/grok-4.5", name: "Grok 4.5" },
  ],
  modelsFetcher: { url: "https://api.tokenrouter.com/v1/models", type: "openai" },
  defaultContextLength: 128000,
};
