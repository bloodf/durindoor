import kimiCoding from "./kimi-coding.js";

const tokenUrl = "https://auth.kimi.ai/api/oauth/token";

export default {
  id: "kimi-ai",
  alias: "kimi-ai",
  aliases: ["kimi.ai"],
  display: {
    name: "Kimi Coding (International)",
    icon: "psychology",
    color: "#1E40AF",
    textIcon: "KC",
    website: "https://www.kimi.ai",
  },
  category: "oauth",
  transport: {
    // The regional OAuth adapter uses the Chat Completions wire protocol.
    baseUrl: "https://api.kimi.ai/coding/v1/chat/completions",
    format: "openai",
    clientId: kimiCoding.transport.clientId,
    refreshUrl: tokenUrl,
    auth: { oauth: { header: "Authorization", scheme: "bearer" }, hooks: ["kimiDeviceHeaders"] },
  },
  models: kimiCoding.models,
  oauth: {
    deviceCodeUrl: "https://auth.kimi.ai/api/oauth/device_authorization",
    tokenUrl,
    refreshLeadMs: kimiCoding.oauth.refreshLeadMs,
  },
};
