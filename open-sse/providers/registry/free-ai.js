// Free.ai: OpenAI-style chat at `/v1/chat/` (trailing slash, not `/chat/completions`).
// The default executor uses transport.baseUrl verbatim, so no path override code is needed.
// Models come from GET /v1/models at runtime (no static list; the ids are not documented).
// Unverified: no live call was made; the /v1/models response shape and chat/stream behavior are unconfirmed.
// Terms: see "Free.ai" in docs/providers/free-and-local.mdx (resale clause).
export default {
  id: "free-ai",
  alias: "free-ai",
  display: {
    name: "Free.ai",
    icon: "redeem",
    color: "#22C55E",
    textIcon: "FA",
    website: "https://free.ai",
    notice: {
      text: "Free tier is rate limited (about 30K tokens/day, 60 requests/min, 1000 requests/month). Keys look like sk-free-....",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasFree: true,
  transport: {
    baseUrl: "https://api.free.ai/v1/chat/",
    format: "openai",
  },
  models: [],
  modelsFetcher: { url: "https://api.free.ai/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
