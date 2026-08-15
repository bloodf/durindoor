import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "ollama",
  priority: 30,
  hidden: true,
  hasFree: true,
  alias: "ollama",
  aliases: ["ollama-search"],
  display: {
    name: "Ollama Cloud",
    icon: "cloud",
    color: "#ffffffff",
    textIcon: "OL",
    website: "https://ollama.com",
    notice: {
      text: "Free tier: light usage, 1 cloud model at a time (limits reset every 5h & 7d). Pro $20/mo · Max $100/mo.",
      apiKeyUrl: "https://ollama.com/settings/keys",
    },
  },
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  quirks: {
    preserveNativeClaudeThinking: true,
    normalizeNativeClaudeTransport: true,
    dropClaudeCacheControl: true,
    claudeImagesRequireBase64: true,
  },
  thinkingFormat: "ollama",
  transport: {
    baseUrl: "https://ollama.com/api/chat",
    validateUrl: "https://ollama.com/api/tags",
    format: "ollama",
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  transports: [
    {
      format: "claude",
      baseUrl: "https://ollama.com/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      // COMP-04: ollama cloud authenticates with Authorization: Bearer (same scheme as the
      // working /api/chat path — ollama.com auth domain), NOT the Anthropic-compat x-api-key
      // convention. Confirmed by live probe: x-api-key raw → 401 Unauthorized.
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [
    { id: "gpt-oss:120b", name: "GPT OSS 120B" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "glm-5", name: "GLM 5" },
    { id: "minimax-m2.5", name: "MiniMax M2.5" },
    { id: "glm-4.7-flash", name: "GLM 4.7 Flash" },
    { id: "qwen3.5", name: "Qwen3.5" },
    { id: "minimax-m3", name: "MiniMax M3" },
  ],
  serviceKinds: ["llm", "webSearch"],
  searchConfig: {
    baseUrl: "https://ollama.com/api/web_search",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    costPerQuery: 0,
    freeMonthlyQuota: 1000,
    searchTypes: ["web"],
    defaultMaxResults: 5,
    maxMaxResults: 10,
    timeoutMs: 10000,
    cacheTTLMs: 300000,
  },
  features: {
    usage: true,
    // Ollama Cloud authenticates with an API key (ollama.com/settings/keys), so it
    // must also join USAGE_APIKEY_PROVIDERS (derived from `usageApikey`) or the
    // /api/usage/[connectionId] route rejects key-based cloud connections before
    // the dispatcher runs. ollama-local intentionally stays unregistered.
    usageApikey: true,
  },
};
