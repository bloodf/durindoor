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
      // https://platform.kimi.ai/docs/models.md — K2 unavailable to new users from 2026-10-31; retires end of December 2026.
      text: "K2 series models (kimi-k2.7-code*, kimi-k2.6) are unavailable to new users from 2026-10-31 and retire by the end of December 2026. Prefer kimi-k3.1-pro.",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.moonshot.ai/anthropic/v1/messages",
    format: "claude",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  // IDs and limits from https://platform.kimi.ai/docs/models.md and
  // https://platform.kimi.ai/docs/pricing/chat.md. Per-token prices are unverified.
  models: [
    { id: "kimi-k3.1-pro", name: "Kimi K3.1 Pro", supportsVision: true, supportsReasoning: true, contextLength: 1048576 },
    { id: "kimi-k3.1-pro-highspeed", name: "Kimi K3.1 Pro Highspeed", supportsVision: true, supportsReasoning: true, contextLength: 1048576 },
    { id: "kimi-k3", name: "Kimi K3", supportsVision: true, supportsReasoning: true, contextLength: 1048576 },
    // K2 series: unavailable to new users from 2026-10-31; retires end of December 2026.
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", supportsVision: true, supportsReasoning: true, contextLength: 262144, deprecated: true },
    { id: "kimi-k2.7-code-highspeed", name: "Kimi K2.7 Code Highspeed", supportsVision: true, supportsReasoning: true, contextLength: 262144, deprecated: true },
    { id: "kimi-k2.6", name: "Kimi K2.6", supportsVision: true, supportsReasoning: true, contextLength: 262144, deprecated: true },
  ],
  serviceKinds: ["llm","webSearch"],
  searchViaChat: {
    defaultModel: "kimi-k3.1-pro",
    endpoint: KIMI_PLATFORM_CHAT_URL,
    pricingUrl: "https://platform.kimi.ai/docs/pricing/chat",
  },
};
