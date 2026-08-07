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
      anthropicVersion: true,
      hooks: [
        "claudeOverlay",
      ],
    },
  },
  // transports are alternate per-format runtimes. They MUST inherit the
  // primary transport's auth headers and URL suffix; otherwise DefaultExecutor
  // (which uses credentials.runtimeTransport) would drop them when the runtime
  // is selected. Codex review PR #126 caught this regression.
  transports: [
    {
      format: "claude",
      baseUrl: "https://agentrouter.org/v1/messages",
      urlSuffix: "?beta=true",
      headers: { ...CLAUDE_CLI_SPOOF_HEADERS },
      auth: {
        combined: true,
        header: "x-api-key",
        scheme: "raw",
        apiKey: { header: "x-api-key", scheme: "raw" },
        anthropicVersion: true,
        hooks: ["claudeOverlay"],
      },
    },
    {
      format: "openai",
      baseUrl: "https://agentrouter.org/v1/chat/completions",
      // OpenAI transport does not require Claude spoof headers; keep an empty
      // headers object so DefaultExecutor does not try to fall back to the
      // primary transport's headers and break the cookie-shape request.
      headers: {},
    },
  ],
  passthroughModels: true,
  models: [
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", targetFormat: "claude" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", targetFormat: "claude" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "deepseek-v3.2", name: "DeepSeek V3.2", targetFormat: "openai" },
  ],
  passthroughModels: true,
};
