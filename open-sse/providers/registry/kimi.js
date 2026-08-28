import { CLAUDE_API_HEADERS, KIMI_CODING_BASE_URL, KIMI_CODING_OPENAI_URL, KIMI_PLATFORM_CHAT_URL } from "../shared.js";

export default {
  id: "kimi",
  priority: 170,
  alias: "kimi",
  display: {
    name: "Kimi",
    icon: "psychology",
    color: "#1E3A8A",
    textIcon: "KM",
    website: "https://www.kimi.com",
    notice: {
      apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: KIMI_CODING_BASE_URL,
    format: "claude",
    headers: { ...CLAUDE_API_HEADERS },
    reasoningInject: {
      scope: "all",
    },
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
    },
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  transports: [
    {
      format: "openai",
      baseUrl: KIMI_CODING_OPENAI_URL,
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: KIMI_CODING_BASE_URL,
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
    // Kimi Open Platform API keys use the documented international endpoint.
    // The `-apikey` suffix is a transport lookup key, not an output format.
    {
      format: "openai-apikey",
      baseUrl: KIMI_PLATFORM_CHAT_URL,
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [
    /** `k3[1m]` is documented only as a Claude Code inbound spelling; emit canonical `k3`. */
    { id: "k3", name: "Kimi K3", aliases: ["k3[1m]"] },
    { id: "k3-256k", name: "Kimi K3 256K" },
    { id: "kimi-for-coding", name: "Kimi K2.7 Code" },
    { id: "kimi-for-coding-highspeed", name: "Kimi K2.7 Code HighSpeed" },
  ],
  serviceKinds: ["llm","webSearch"],
  searchViaChat: {
    defaultModel: "kimi-for-coding",
    endpoint: KIMI_PLATFORM_CHAT_URL,
    pricingUrl: "https://platform.moonshot.ai/docs/pricing/chat",
  },
  oauth: {
    clientId: "17e5f671-d194-4dfb-9706-5516cb48c098",
    deviceCodeUrl: "https://auth.kimi.com/api/oauth/device_authorization",
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    refreshUrl: "https://auth.kimi.com/api/oauth/token",
    refreshLeadMs: 300000,
    authorizeDeviceUrl: "https://www.kimi.com/code/authorize_device",
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
