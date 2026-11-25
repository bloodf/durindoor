// Y-API — OpenAI-compatible pay-per-token gateway operated by bestvirtualgoods.com.
//
// First-party contract (inspected 2026-11-20):
//   - Integration guide: https://y-api.bestvirtualgoods.com/docs
//   - Error reference:    https://y-api.bestvirtualgoods.com/docs/errors
//   - OpenAPI 3.1:        https://y-api.bestvirtualgoods.com/openapi.json
//   - Terms of service:   https://y-api.bestvirtualgoods.com/terms
//
// Upstream parity: OmniRoute release/v3.8.55 @ 4624250231f49ed118fb4522a9d735e4894322c6,
// open-sse/config/providers/registry/y-api/index.ts — same chat-completions base
// URL, same models URL, empty static catalog and passthrough models. The upstream
// entry declares no Anthropic route; the Anthropic endpoint below comes from the
// provider's own OpenAPI document, not from upstream.
//
// Endpoint contract (https://y-api.bestvirtualgoods.com/openapi.json):
//   POST /v1/chat/completions  Authorization: Bearer <key>  — OpenAI Chat Completions
//   GET  /v1/models             Authorization: Bearer <key>  — authoritative model catalog
//   POST /v1/messages           x-api-key: <key>            — Anthropic Messages, same catalog
//
// Authorization is isolated per transport: the OpenAI paths send the console-issued
// key as a Bearer token, the Anthropic path sends the same key in the `x-api-key`
// header the Anthropic SDKs use. Neither transport inherits the other's header, so
// a key can never leak into the wrong credential slot.
//
// The catalog is discovered, not seeded: Y-API ids are `vendor/model` and change with
// upstream availability, so the static list stays empty and `passthroughModels` keeps
// a discovered id byte-identical on the wire.
export default {
  id: "y-api",
  alias: "y-api",
  display: {
    name: "Y-API",
    icon: "hub",
    color: "#0D9488",
    textIcon: "YA",
    website: "https://y-api.bestvirtualgoods.com",
    notice: {
      text: "Pay-per-token gateway run by bestvirtualgoods.com. Keys are issued in the console. An exhausted balance returns HTTP 403 insufficient_user_quota (not 429); an invalid or revoked key returns 401.",
      apiKeyUrl: "https://y-api.bestvirtualgoods.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.y-api.bestvirtualgoods.com/v1/chat/completions",
    // GET /v1/models is free and uses the same key, so it is the cheapest
    // credential check: 200 proves the key, 401 disproves it.
    validateUrl: "https://api.y-api.bestvirtualgoods.com/v1/models",
    modelsUrl: "https://api.y-api.bestvirtualgoods.com/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
    quirks: { validationChatFallback: false },
  },
  // Multi-endpoint: an OpenAI-format client reaches /v1/chat/completions and an
  // Anthropic-format client reaches /v1/messages without a translation hop.
  // `anthropic-version` is added by the executor from the auth descriptor.
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.y-api.bestvirtualgoods.com/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" }
    },
    {
      format: "claude",
      baseUrl: "https://api.y-api.bestvirtualgoods.com/v1/messages",
      auth: { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true }
    },
  ],
  models: [],
  modelsFetcher: { url: "https://api.y-api.bestvirtualgoods.com/v1/models", type: "openai" },
  passthroughModels: true,
};
