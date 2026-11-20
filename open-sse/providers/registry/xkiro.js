// Adapted from OmniRoute open-sse/config/providers/registry/xkiro/index.ts
// at 2c4aa9e9af21e2ad27440c4c478c10282154a596.
export default {
  id: "xkiro",
  alias: "xkiro",
  display: {
    name: "X-Kiro",
    icon: "hub",
    color: "#2563EB",
    textIcon: "XK",
    website: "https://xkiro.com",
    notice: { apiKeyUrl: "https://xkiro.com" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.xkiro.com/v1/chat/completions",
    // /v1/models is public and cannot validate credentials.
    validateUrl: "https://api.xkiro.com/v1/usage",
    authHeader: "bearer",
  },
  models: [],
  modelsFetcher: { url: "https://api.xkiro.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
