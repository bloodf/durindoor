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
    defaultContextLength: 128000,
    auth: {
      apiKey: {
        header: "x-api-key",
        scheme: "raw",
      },
      hooks: [
        "claudeOverlay",
      ],
    },
  },
  models: [
    { id: "claude-opus-4-6", name: "Claude 4.6 Opus" },
    { id: "claude-haiku-4-5-20251001", name: "Claude 4.5 Haiku" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "deepseek-v3.2", name: "DeepSeek V3.2" },
  ],
  passthroughModels: true,
};
