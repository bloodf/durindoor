// NoTrack developer API — https://notrack.ai/api/docs (first-party reference, retrieved 2026-11-20).
//
// The documented operator-issued API: base URL `https://api.notrack.ai/v1`, bearer
// auth with an `sk-notrack-…` key created on https://notrack.ai/api-keys, and
// OpenAI Chat Completions only (the Responses API is not served).
//
// This identity is deliberately separate from the consumer chat session that
// upstream OmniRoute exposes as `notrack-web` (cookie auth against
// https://notrack.ai/api/dispatch, model `notrack-c`, upstream alias `ntw`).
// No consumer cookie is read or forwarded here and the legacy web contract is
// not implemented, so `notrack` must not be described as `notrack-web`.
//
// Live service behavior is not verified: the unit fixtures mock the wire.
export default {
  id: "notrack",
  alias: "notrack",
  display: {
    name: "NoTrack",
    icon: "visibility_off",
    color: "#0F766E",
    textIcon: "NT",
    website: "https://notrack.ai",
    notice: {
      apiKeyUrl: "https://notrack.ai/api-keys",
      text: "Developer API key from notrack.ai/api-keys. Text inference only; prepaid credit, billed on the provider-reported token usage.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.notrack.ai/v1/chat/completions",
    // The documented endpoint speaks OpenAI Chat Completions only.
    format: "openai",
    // GET /v1/models rejects a bad key with 401, so it is a real key check and
    // not a public catalog that would fail open.
    validateUrl: "https://api.notrack.ai/v1/models",
  },
  // The developer catalog is served by the same /v1/models endpoint, so the
  // connection-scoped discovery path and the seeded model stay in one place.
  modelsFetcher: { url: "https://api.notrack.ai/v1/models", type: "openai" },
  models: [
    // Prompt + completion must fit the documented 100,000-token window.
    { id: "notrack-uncensored", name: "NoTrack Uncensored", contextLength: 100000 },
  ],
  serviceKinds: ["llm"],
};
