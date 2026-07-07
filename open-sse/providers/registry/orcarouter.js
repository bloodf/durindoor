export default {
  id: "orcarouter",
  alias: "orcarouter",
  display: {
    name: "OrcaRouter",
    icon: "route",
    color: "#0891B2",
    textIcon: "OR",
    website: "https://www.orcarouter.ai",
    notice: { apiKeyUrl: "https://www.orcarouter.ai/console" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.orcarouter.ai/v1/chat/completions",
    // OrcaRouter proxies many upstream model families (OpenAI/Gemini/Claude/
    // Grok/DeepSeek/MiniMax/Qwen) through one OpenAI-compatible endpoint, so
    // force the OpenAI reasoning_effort wire shape instead of letting
    // per-model native patterns (deepseek/minimax/qwen) leak through.
    thinkingFormat: "openai",
    headers: {
      "HTTP-Referer": "https://endpoint-proxy.local",
      "X-Title": "Endpoint Proxy",
    },
  },
  defaultContextLength: 128000,
  models: [
    { id: "orcarouter/auto", name: "Auto (smart routing)", toolCalling: true },
    { id: "openai/gpt-5.5", name: "GPT-5.5", toolCalling: true, supportsReasoning: true, supportsVision: true, contextLength: 1050000, maxOutputTokens: 128000 },
    { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash", toolCalling: true, supportsReasoning: true, supportsVision: true, contextLength: 1048576, maxOutputTokens: 65536 },
    { id: "anthropic/claude-opus-4.8", name: "Claude Opus 4.8", toolCalling: true, supportsReasoning: true, supportsVision: true, contextLength: 1000000, maxOutputTokens: 128000 },
    { id: "grok/grok-4.3", name: "Grok 4.3", toolCalling: true, supportsReasoning: true, supportsVision: true, contextLength: 1000000 },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", toolCalling: true, supportsReasoning: true, contextLength: 1048576, maxOutputTokens: 384000 },
    { id: "minimax/minimax-m2.7", name: "MiniMax M2.7", toolCalling: true, supportsReasoning: true, contextLength: 204800, maxOutputTokens: 2048 },
    { id: "qwen/qwen3.7-max", name: "Qwen3.7 Max", toolCalling: true, contextLength: 1000000, maxOutputTokens: 64000 },
  ],
};
