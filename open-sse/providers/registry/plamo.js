export default {
  id: "plamo",
  alias: "plamo",
  display: {
    name: "PLaMo",
    icon: "public",
    color: "#DC2626",
    textIcon: "PL",
    website: "https://plamo.preferredai.jp/api",
    notice: {
      apiKeyUrl: "https://plamo.preferredai.jp",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.platform.preferredai.jp/v1/chat/completions",
    format: "openai",
  },
  models: [
    {
      id: "plamo-3.0-prime",
      name: "PLaMo 3.0 Prime",
      contextLength: 262144,
      maxOutputTokens: 20000,
    },
  ],
  serviceKinds: ["llm"],
};
