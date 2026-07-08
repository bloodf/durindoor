export default {
  id: "zenmux",
  alias: "zm",
  uiAlias: "zm",
  display: {
    name: "ZenMux",
    icon: "neurology",
    color: "#7C3AED",
    textIcon: "ZM",
    website: "https://zenmux.ai",
    notice: {
      text: "Fully OpenAI-compatible gateway with OpenAI, Anthropic Messages, and Google Gemini protocol surfaces.",
      apiKeyUrl: "https://zenmux.ai",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://zenmux.ai/api/v1/chat/completions",
    validateUrl: "https://zenmux.ai/api/v1/models",
    // ZenMux's OpenAI-compatible surface should receive OpenAI reasoning_effort
    // format rather than family-native thinking fields.
    thinkingFormat: "openai",
  },
  models: [
    { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview (ZenMux)", contextLength: 1048576, supportsVision: true, toolCalling: true, supportsReasoning: true },
    { id: "google/gemini-3-flash-preview", name: "Gemini 3 Flash Preview (ZenMux)", contextLength: 1048576, supportsVision: true, toolCalling: true, supportsReasoning: true },
    { id: "openai/gpt-5", name: "GPT-5 (ZenMux)", contextLength: 400000, supportsVision: true, toolCalling: true, supportsReasoning: true },
    { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5 (ZenMux)", contextLength: 200000, supportsVision: true, toolCalling: true, supportsReasoning: true },
    { id: "anthropic/claude-opus-4.5", name: "Claude Opus 4.5 (ZenMux)", contextLength: 200000, supportsVision: true, toolCalling: true, supportsReasoning: true },
    { id: "deepseek/deepseek-chat", name: "DeepSeek V3.2 Chat (ZenMux)", contextLength: 128000, supportsVision: false, toolCalling: true, supportsReasoning: false },
    { id: "x-ai/grok-4.1-fast", name: "Grok 4.1 Fast (ZenMux)", contextLength: 131072, supportsVision: false, toolCalling: true, supportsReasoning: true },
    { id: "mistralai/mistral-large-2512", name: "Mistral Large 2512 (ZenMux)", contextLength: 128000, supportsVision: true, toolCalling: true, supportsReasoning: false },
    { id: "z-ai/glm-4.6v-flash", name: "GLM 4.6V Flash (ZenMux)", contextLength: 128000, supportsVision: true, toolCalling: true, supportsReasoning: false },
  ],
  modelsFetcher: { url: "https://zenmux.ai/api/v1/models", type: "openai" },
  defaultContextLength: 128000,
};
