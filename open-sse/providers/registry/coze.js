export default {
  id: "coze",
  alias: "coze",
  display: {
    name: "Coze",
    icon: "smart_toy",
    color: "#3B82F6",
    textIcon: "CZ",
    website: "https://coze.com",
    notice: {
      text: "Free ByteDance agent platform. Bot building + LLM access.",
      apiKeyUrl: "https://coze.com/open/api",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasFree: true,
  transport: {
    baseUrl: "https://api.coze.com/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "claude-3-7-sonnet-20250514", name: "Claude 3.7 Sonnet" },
  ],
  passthroughModels: true,
  serviceKinds: ["llm"],
};
