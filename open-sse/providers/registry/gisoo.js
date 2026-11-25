/**
 * Gisoo (https://gisoo.pro) — prepaid multi-model relay, OpenAI-compatible `/api/v1`.
 *
 * `GET https://gisoo.pro/api/v1/models` is PUBLIC: it answers 200 without a key
 * and even with an invalid one, so it cannot prove a credential and the
 * dashboard discovers the catalog without sending the stored key
 * (see open-sse/providers/gisooCatalog.js). `passthroughModels` keeps every id
 * the live catalog publishes usable without a registry change here.
 *
 * Prepaid credit only: there is no free tier. An unverified account may spend
 * up to $2; after that the upstream answers `kyc_required` and the identity
 * must be verified in the Gisoo app.
 *
 * Seed ids verified against the live `?type=chat` catalog (all `type: "chat"`,
 * `is_free: false`). Kept small on purpose — the live catalog also carries
 * image, audio, video, music and embedding ids.
 */
export default {
  id: "gisoo",
  alias: "gisoo",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  display: {
    name: "Gisoo",
    icon: "hub",
    color: "#0F766E",
    textIcon: "GS",
    website: "https://gisoo.pro",
    notice: {
      text: "Prepaid multi-model relay with an OpenAI-compatible /api/v1 endpoint. One key covers the whole catalog; the model list is public, so discovery never sends the key.",
      apiKeyUrl: "https://gisoo.pro/app",
    },
  },
  transport: {
    baseUrl: "https://gisoo.pro/api/v1/chat/completions",
    // The catalog endpoint is public and answers 200 even for a rejected key,
    // so it would mark any bad key "valid" (fail-open, like Ollama's /api/tags).
    // /api/v1/me is the authenticated account endpoint: it answers 401 for a
    // missing, malformed or rejected key.
    validateUrl: "https://gisoo.pro/api/v1/me",
  },
  serviceKinds: ["llm"],
  models: [
    { id: "claude-opus-5-5", name: "Claude Opus 5.5", contextLength: 1000000, maxOutputTokens: 128000, supportsVision: true, supportsReasoning: true },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", contextLength: 1000000, maxOutputTokens: 128000, supportsVision: true, supportsReasoning: true },
    { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", contextLength: 1000000, maxOutputTokens: 128000, supportsVision: true, supportsReasoning: true },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol", contextLength: 1050000, maxOutputTokens: 128000, supportsVision: true, supportsReasoning: true },
    { id: "gpt-5.5", name: "GPT-5.5", contextLength: 1050000, maxOutputTokens: 128000, supportsVision: true, supportsReasoning: true },
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", contextLength: 1048576, maxOutputTokens: 65536, supportsVision: true, supportsReasoning: true },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (Preview)", contextLength: 1048576, maxOutputTokens: 65536, supportsVision: true, supportsReasoning: true },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", contextLength: 1000000, maxOutputTokens: 384000, supportsVision: true, supportsReasoning: true },
    { id: "deepseek-flash", name: "DeepSeek Flash", contextLength: 1000000, maxOutputTokens: 384000, supportsVision: true, supportsReasoning: true },
  ],
  // The public catalog endpoint. Discovery through the dedicated resolver in
  // open-sse/providers/gisooCatalog.js sends NO Authorization header; this
  // declaration keeps the registry-level fetcher off the connection's
  // client-writable baseUrl and drives the /v1/models live catalog union.
  modelsFetcher: { url: "https://gisoo.pro/api/v1/models?type=chat", type: "openai" },
  passthroughModels: true,
};
