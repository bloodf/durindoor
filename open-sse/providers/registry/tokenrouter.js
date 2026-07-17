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
  models: [
    { id: "minimax-3", name: "MiniMax 3 (free, TokenRouter)", contextLength: 128000, toolCalling: true },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro (TokenRouter)", contextLength: 163840, toolCalling: true, supportsReasoning: true },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash (TokenRouter)", contextLength: 163840, toolCalling: true, supportsReasoning: true },
  ],
  modelsFetcher: { url: "https://api.tokenrouter.com/v1/models", type: "openai" },
  defaultContextLength: 128000,
};
