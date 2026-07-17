export default {
  id: "api-airforce",
  alias: "af",
  uiAlias: "af",
  display: {
    name: "Api.airforce",
    icon: "flight",
    color: "#1E3A5F",
    textIcon: "AF",
    website: "https://api.airforce",
    notice: {
      text: "55 free tier models including Grok-3, Claude 3.7, Qwen3, Kimi-K2, Gemini 2.5 Flash, DeepSeek-V3",
      apiKeyUrl: "https://panel.api.airforce",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.airforce/v1/chat/completions",
    // OpenAI-compatible gateway: mixed model families must use OpenAI reasoning_effort.
    thinkingFormat: "openai",
    // generic OpenAI-compatible probe hits the real /v1/models endpoint
    // instead of deriving it from baseUrl. modelsFetcher below reuses the
    // same URL for the listed-models picker.
    validateUrl: "https://api.airforce/v1/models",
    defaultContextLength: 128000,
    headers: {
      "HTTP-Referer": "https://endpoint-proxy.local",
      "X-Title": "Endpoint Proxy",
    },
  },
  models: [
    { id: "x-ai/grok-3", name: "Grok-3 (Free)", contextLength: 131072, maxOutputTokens: 65536 },
    { id: "x-ai/grok-2-1212", name: "Grok-2 1212 (Free)", contextLength: 131072, maxOutputTokens: 65536 },
    { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet (Free)", contextLength: 200000, maxOutputTokens: 8192 },
    { id: "qwen/qwen3-32b", name: "Qwen3 32B (Free)", contextLength: 128000, maxOutputTokens: 8192 },
    { id: "moonshot/kimi-k2.6", name: "Kimi K2.6 (Free)", contextLength: 262144, maxOutputTokens: 65536 },
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash (Free)", contextLength: 1048576, maxOutputTokens: 65536 },
    { id: "deepseek/deepseek-v3", name: "DeepSeek V3 (Free)", contextLength: 262144, maxOutputTokens: 16384 },
  ],
  modelsFetcher: { url: "https://api.airforce/v1/models", type: "openai" },
};
