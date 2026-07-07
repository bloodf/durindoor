export default {
  id: "lm-studio",
  priority: 66,
  alias: "lmstudio",
  uiAlias: "lmstudio",
  display: {
    name: "LM Studio",
    icon: "server",
    color: "#4A148C",
    textIcon: "LM",
    website: "https://lmstudio.ai",
  },
  category: "apikey",
  authType: "apikey",
  authHint: "API key optional. Configure the local LM Studio OpenAI-compatible base URL (default: http://localhost:1234/v1).",
  transport: {
    baseUrl: "http://localhost:1234/v1",
    format: "openai",
  },
  models: [],
  passthroughModels: true,
};
