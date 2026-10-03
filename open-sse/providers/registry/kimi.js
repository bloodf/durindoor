import { KIMI_PLATFORM_CHAT_URL } from "../shared.js";

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
      apiKeyUrl: "https://platform.kimi.ai/console/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.moonshot.ai/anthropic/v1/messages",
    format: "claude",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  models: [
    { id: "kimi-k3", name: "Kimi K3", supportsVision: true, supportsReasoning: true },
  ],
  serviceKinds: ["llm","webSearch"],
  searchViaChat: {
    defaultModel: "kimi-k3",
    endpoint: KIMI_PLATFORM_CHAT_URL,
    pricingUrl: "https://platform.kimi.ai/docs/pricing/chat",
  },
};
