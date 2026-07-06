export default {
  id: "moonshot",
  alias: "moonshot",
  display: {
    name: "Moonshot AI",
    icon: "nightlight",
    color: "#111827",
    textIcon: "KS",
    website: "https://www.moonshot.ai",
    notice: { apiKeyUrl: "https://platform.moonshot.ai/console/api-keys" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.moonshot.ai/v1/chat/completions",
  },
  models: [
    { id: "kimi-k2.6", name: "kimi-k2.6" },
    { id: "kimi-k2.5", name: "kimi-k2.5" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", contextLength: 262144, maxOutputTokens: 262144, supportsVision: true, supportsReasoning: true, unsupportedParams: ["temperature", "top_p"] },
    { id: "kimi-k2.7-code-highspeed", name: "Kimi K2.7 Code (High Speed)", contextLength: 262144, maxOutputTokens: 262144, supportsVision: true, supportsReasoning: true, unsupportedParams: ["temperature", "top_p"] },
  ],
};
