import { CLAUDE_CLI_SPOOF_HEADERS } from "../shared.js";

export default {
  id: "agentrouter",
  alias: "agentrouter",
  priority: 12,
  display: {
    name: "AgentRouter",
    icon: "agentrouter",
    color: "#D97757",
    website: "https://agentrouter.org",
    notice: {
      signupUrl: "https://agentrouter.org",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://agentrouter.org/v1/messages",
    format: "claude",
    urlSuffix: "?beta=true",
    headers: { ...CLAUDE_CLI_SPOOF_HEADERS },
    defaultContextLength: 128000,
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
      apiKey: {
        header: "x-api-key",
        scheme: "raw",
      },
      hooks: [
        "claudeOverlay",
      ],
    },
  },
  transports: [
    {
      format: "claude",
      baseUrl: "https://agentrouter.org/v1/messages",
    },
    {
      format: "openai",
      baseUrl: "https://agentrouter.org/v1/chat/completions",
    },
  ],
  passthroughModels: true,
  models: [
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", targetFormat: "claude" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", targetFormat: "claude" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "deepseek-v3.2", name: "DeepSeek V3.2", targetFormat: "openai" },
  ],
};
