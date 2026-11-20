// OAuth flow adapted from OmniRoute #9869 (src/lib/oauth/providers/openference.ts).
export default {
  id: "openference",
  alias: "of",
  display: { name: "Openference", icon: "route", color: "#0EA5E9", textIcon: "OF", website: "https://openference.com",
    notice: { text: "OAuth requires an operator-configured Openference client. Live account verification is pending." } },
  category: "oauth",
  transport: {
    baseUrl: "https://api.openference.com/v1/chat/completions",
    validateUrl: "https://api.openference.com/v1/models",
    format: "openai",
  },
  oauth: {
    authorizeUrl: "https://openference.com/app/oauth/authorize",
    tokenUrl: "https://openference.com/oauth/token",
    scope: "openid profile email model:invoke offline_access",
    codeChallengeMethod: "S256",
  },
  models: [],
  modelsFetcher: { url: "https://api.openference.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
