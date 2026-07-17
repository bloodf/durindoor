import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "kimi-coding-apikey",
  priority: 125,
  alias: "kmca",
  display: {
    name: "Kimi Coding API Key",
    icon: "psychology",
    color: "#1E40AF",
    textIcon: "KC",
    website: "https://kimi.moonshot.cn",
    notice: {
      apiKeyUrl: "https://platform.moonshot.ai/console/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.kimi.com/coding/v1/messages",
    format: "claude",
    urlSuffix: "?beta=true",
    headers: { ...CLAUDE_API_HEADERS },
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
    },
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.kimi.com/coding/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://api.kimi.com/coding/v1/messages",
      urlSuffix: "?beta=true",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
  ],
  // Ported from OmniRoute kimi/coding-apikey at source commit 3ddcee6.
  models: [
    { id: "kimi-k3", name: "Kimi K3", contextLength: 1048576, maxOutputTokens: 262144, supportsVision: true, supportsReasoning: true, unsupportedParams: ["temperature", "top_p"] },
    { id: "kimi-k2.6", name: "Kimi K2.6", contextLength: 262144, maxOutputTokens: 262144, supportsVision: true },
    { id: "kimi-k2.6-thinking", name: "Kimi K2.6 Thinking", contextLength: 262144, maxOutputTokens: 262144 },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code", contextLength: 262144, maxOutputTokens: 262144, supportsVision: true, supportsReasoning: true, unsupportedParams: ["temperature", "top_p"] },
    { id: "kimi-k2.7-code-highspeed", name: "Kimi K2.7 Code (High Speed)", contextLength: 262144, maxOutputTokens: 262144, supportsVision: true, supportsReasoning: true, unsupportedParams: ["temperature", "top_p"] },
    { id: "moonshotai/kimi-k2.7-code", name: "Kimi K2.7 Code", contextLength: 262144, maxOutputTokens: 262144 },
  ],
  defaultContextLength: 262144,
};
