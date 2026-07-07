import { CLAUDE_CLI_SPOOF_HEADERS } from "../shared.js";

export default {
  id: "agentrouter",
  alias: "agentrouter",
  uiAlias: "agentrouter",
  display: {
    name: "AgentRouter",
    icon: "agentrouter",
    color: "#10B981",
    textIcon: "AR",
    website: "https://agentrouter.org",
    notice: {
      text: "$200 free credits on signup - multi-model routing gateway",
      signupUrl: "https://agentrouter.org/register",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://agentrouter.org/v1/messages",
    format: "claude",
    // AgentRouter gates on Claude CLI identity while still authenticating with x-api-key.
    headers: { ...CLAUDE_CLI_SPOOF_HEADERS },
    defaultContextLength: 128000,
    auth: { combined: true, header: "x-api-key", scheme: "raw" },
  },
  // Multi-endpoint: route Claude-native ids to /v1/messages and OpenAI-style ids
  // to /v1/chat/completions so mixed-format client requests avoid lossy translation.
  transports: [
    {
      format: "openai",
      baseUrl: "https://agentrouter.org/v1/chat/completions",
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
    {
      format: "claude",
      baseUrl: "https://agentrouter.org/v1/messages",
      headers: { ...CLAUDE_CLI_SPOOF_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
  ],
  models: [
    { id: "claude-opus-4-6", name: "Claude 4.6 Opus", targetFormat: "claude" },
    { id: "claude-haiku-4-5-20251001", name: "Claude 4.5 Haiku", targetFormat: "claude" },
    { id: "glm-5.1", name: "GLM 5.1", targetFormat: "openai" },
    { id: "deepseek-v3.2", name: "DeepSeek V3.2", targetFormat: "openai" },
  ],
  passthroughModels: true,
};
