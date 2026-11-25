// Contract: https://mnnai.ru/docs — one OpenAI-compatible chat completions
// endpoint at https://api.mnnai.ru/v1/chat/completions, Bearer API keys,
// optional streaming over server-sent events, and an authenticated model list
// at https://api.mnnai.ru/v1/models.
//
// Ported from OmniRoute release/v3.8.55
// (4624250231f49ed118fb4522a9d735e4894322c6),
// open-sse/config/providers/registry/mnn-ai/index.ts.
//
// The upstream entry uses the composed default executor with an empty static
// catalog and passthrough models, so DurinDoor reuses the existing
// OpenAI-compatible plumbing instead of adding a provider-specific executor.
// The model list is read from the live authenticated /v1/models endpoint;
// nothing is seeded.
//
// Only the documented chat API is ported. The Anthropic-compatible
// /v1/messages route, the Responses API, and the media, embedding,
// moderation and web-search surfaces are not part of the pinned provider
// contract and stay out of this integration.
export default {
  id: "mnn-ai",
  alias: "mnn-ai",
  display: {
    name: "MNN AI",
    icon: "hub",
    color: "#334155",
    textIcon: "MNN",
    website: "https://mnnai.ru",
    notice: {
      apiKeyUrl: "https://mnnai.ru/dashboard",
      text: "Model IDs come from the live /v1/models endpoint for the saved key. Plan limits, model availability and pricing are set by MNN AI and are not verified by DurinDoor.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.mnnai.ru/v1/chat/completions",
    // Bearer-authenticated model list. The same URL serves the connection key
    // check and model discovery, so validation and discovery cannot disagree
    // about the credential. Whether the upstream rejects a bad key here is
    // not verified; the docs only show the key being sent.
    validateUrl: "https://api.mnnai.ru/v1/models",
    modelsUrl: "https://api.mnnai.ru/v1/models",
    authHeader: "bearer",
  },
  // The upstream catalog is empty on purpose: MNN AI publishes no fixed model
  // list, and the live endpoint reports what the saved key can reach.
  models: [],
  modelsFetcher: { url: "https://api.mnnai.ru/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
