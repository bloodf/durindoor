export default {
  id: "trae",
  alias: "tr",
  priority: 100,
  display: {
    name: "Trae",
    icon: "code",
    color: "#111827",
    textIcon: "TR",
    website: "https://trae.ai",
  },
  category: "oauth",
  transport: {
    baseUrl: "https://core-normal.trae.ai/api/remote/v1",
    format: "openai",
    defaultContextLength: 272000,
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "raw",
    },
  },
  oauth: {
    flowType: "import_token",
    apiEndpoint: "https://core-normal.trae.ai/api/remote/v1",
    chatEndpoint: "https://core-normal.trae.ai/api/remote/v1/chat_sessions",
    webUrl: "https://solo.trae.ai",
    tokenLifetimeDays: 14,
  },
  // Trae SOLO model catalog, ported from cheaper-inference/OmniRoute
  // `open-sse/config/providers/registry/trae/index.ts` (added in release
  // v3.8.27, PR #3968). `auto` and `work` are the two SOLO session modes the
  // executor resolves (`open-sse/executors/trae.js`); the rest are the named
  // models the SOLO remote agent serves. Model ids travel verbatim as
  // `model_name`, so no upstreamModelId mapping is needed.
  models: [
    { id: "auto", name: "Auto (Code · Server Picks)" },
    { id: "work", name: "Work (Auto · fast)" },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
    { id: "gemini-3-flash-solo", name: "Gemini 3 Flash" },
    { id: "minimax-m3", name: "minimax M3", contextLength: 1048576, supportsVision: true },
    { id: "minimax-m2.7", name: "minimax M2.7" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "gpt-5.4", name: "GPT 5.4" },
    { id: "gpt-5.2", name: "GPT 5.2" },
  ],
};
