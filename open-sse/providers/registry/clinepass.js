export default {
  id: "clinepass",
  priority: 85,
  alias: "clinepass",
  uiAlias: "clinepass",
  display: {
    name: "ClinePass",
    icon: "vpn_key",
    color: "#5B9BD5",
    textIcon: "CP",
    website: "https://cline.bot",
    notice: {
      signupUrl: "https://app.cline.bot",
    },
  },
  category: "oauth",
  // ClinePass authenticates with a plain API key from app.cline.bot/settings/api-keys.
  // The Cline OAuth extension flow does not issue tokens the ClinePass consumer
  // endpoint accepts (HTTP 401), so apikey is the default mode.
  authModes: ["apikey", "oauth"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.cline.bot/api/v1/chat/completions",
    // Streaming-only upstream: a non-streaming request returns a {"data":{...}}
    // envelope without a `success` flag. chatCore streams upstream and rebuilds
    // JSON for stream:false clients.
    forceStream: true,
    headers: {
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      hooks: [
        "clineHeaders",
      ],
    },
  },
  // Fallback only: the live list is the recommended-models feed (clinePass[]).
  models: [
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash (ClinePass)", upstreamModelId: "cline-pass/deepseek-v4.1-flash" },
    { id: "mimo-v2.6-flash", name: "MiMo-V2.6 Flash (ClinePass)", upstreamModelId: "cline-pass/mimo-v2.6-flash" },
    { id: "mimo-v2.6-pro", name: "MiMo-V2.6-Pro (ClinePass)", upstreamModelId: "cline-pass/mimo-v2.6-pro" },
    { id: "glm-5.3", name: "GLM-5.3 (ClinePass)", upstreamModelId: "cline-pass/glm-5.3" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro (ClinePass)", upstreamModelId: "cline-pass/deepseek-v4-pro" },
    { id: "qwen3.8-max", name: "Qwen3.8 Max (ClinePass)", upstreamModelId: "cline-pass/qwen3.8-max" },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor (ClinePass)", upstreamModelId: "cline-pass/muse-spark-1.3-contributor" },
    { id: "kimi-k3", name: "Kimi K3 (ClinePass)", upstreamModelId: "cline-pass/kimi-k3" },
    { id: "glm-5.3-flash", name: "GLM-5.3 Flash (ClinePass)", upstreamModelId: "cline-pass/glm-5.3-flash" },
    { id: "minimax-m3", name: "MiniMax M3 (ClinePass)", upstreamModelId: "cline-pass/minimax-m3" },
    { id: "qwen3.7-max", name: "Qwen3.7 Max (ClinePass)", upstreamModelId: "cline-pass/qwen3.7-max" },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus (ClinePass)", upstreamModelId: "cline-pass/qwen3.7-plus" },
    { id: "mimo-v2.5-pro", name: "MiMo-V2.5-Pro (ClinePass)", upstreamModelId: "cline-pass/mimo-v2.5-pro" },
    { id: "mimo-v2.5", name: "MiMo-V2.5 (ClinePass)", upstreamModelId: "cline-pass/mimo-v2.5" },
  ],
  oauth: {
    appBaseUrl: "https://app.cline.bot",
    apiBaseUrl: "https://api.cline.bot",
    authorizeUrl: "https://api.cline.bot/api/v1/auth/authorize",
    tokenUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
  },
  thinkingConfig: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
  },
  usage: { url: "https://api.cline.bot/api/v1/users/me/plan/usage-limits" },
  features: {
    usage: true,
    // API-key connections use the same usage-limits endpoint (plain Bearer).
    usageApikey: true,
  },
};
