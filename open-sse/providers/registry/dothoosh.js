import {
  DOTHOOSH_CHAT_COMPLETIONS_URL,
  DOTHOOSH_MESSAGES_URL,
  DOTHOOSH_OPENAI_MODELS_URL,
  DOTHOOSH_RESPONSES_URL
} from "../dothooshCatalog.js";

// DotHoosh — Iranian AI gateway, OpenAI- and Anthropic-compatible, billed in
// Toman (IRT) from a prepaid wallet. One API key reaches every model.
//
// Endpoints and auth come from the provider's own documentation
// (https://gateway.dothoosh.com/docs): the OpenAI paths take
// "Authorization: Bearer <key>", the Anthropic path takes x-api-key only
// (plus anthropic-version: 2023-06-01) because sending both auth headers is
// rejected. All of them live on the provider host, so a stored key never
// leaves it.
export default {
  id: "dothoosh",
  priority: 120,
  alias: "dothoosh",
  aliases: [
    "dh",
  ],
  uiAlias: "dothoosh",
  display: {
    name: "DotHoosh",
    icon: "hub",
    color: "#F4600C",
    textIcon: "DH",
    website: "https://gateway.dothoosh.com",
    notice: {
      text: "DotHoosh: Iranian AI gateway, OpenAI- and Anthropic-compatible, billed in Toman (IRT) from a prepaid wallet. One API key reaches every model; the model list is read live from the provider per key.",
      apiKeyUrl: "https://gateway.dothoosh.com/signin",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    // Default lane: OpenAI Chat Completions. `thinkingFormat` is deliberately
    // not declared, so each model resolves its own wire format through
    // providers/capabilities.js.
    baseUrl: DOTHOOSH_CHAT_COMPLETIONS_URL,
    validateUrl: DOTHOOSH_OPENAI_MODELS_URL,
  },
  // Multi-endpoint: pick the transport matching the client sourceFormat to skip
  // translation. The gateway verifies each protocol per model, so the lanes a
  // model is served on are read from the listing (providers/dothooshCatalog.js)
  // with a name-based fallback for ids the listing does not carry yet.
  transports: [
    { format: "openai", baseUrl: DOTHOOSH_CHAT_COMPLETIONS_URL, auth: { combined: true, header: "Authorization", scheme: "bearer" } },
    { format: "claude", baseUrl: DOTHOOSH_MESSAGES_URL, auth: { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true } },
    { format: "openai-responses", baseUrl: DOTHOOSH_RESPONSES_URL, auth: { combined: true, header: "Authorization", scheme: "bearer" } },
  ],
  // No static model list: the catalog is the provider's own listing. The
  // registry fetcher marks the catalogue for the dashboard ("Sync models" and
  // the keyless suggestion route); the per-connection import reads the same
  // URL with the user's key, and the Anthropic listing is merged with it so
  // Claude-only models are listed too. Any listed id passes via
  // passthroughModels, so a new model needs no registry change.
  modelsFetcher: { url: DOTHOOSH_OPENAI_MODELS_URL, type: "openai" },
  passthroughModels: true,
};
