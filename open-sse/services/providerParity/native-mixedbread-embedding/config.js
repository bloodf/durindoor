// Mixedbread native embeddings metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/embeddingRegistry.ts (`mixedbread`: id "mixedbread", baseUrl
// "https://api.mixedbread.com/v1/embeddings", authType "apikey", authHeader
// "bearer", models [{ id: "mixedbread-ai/mxbai-embed-large-v1", name:
// "Mixedbread Embed Large v1", dimensions: 1024 }, { id:
// "mixedbread-ai/mxbai-embed-2d-large-v1", name: "Mixedbread Embed 2D Large
// v1", dimensions: 1024 }]) and src/shared/constants/providers/apikey/
// specialty-media.ts (`mixedbread`: alias "mxbai", name "Mixedbread AI",
// website https://www.mixedbread.com, free tier, bearer API key). Wire
// behavior comes from open-sse/handlers/embeddings.ts: one `POST` of
// `{ model, input }` (plus `dimensions` / `encoding_format` only when the
// client sent them) with `Authorization: Bearer <apiKey || accessToken>` and
// `Content-Type: application/json`, answered by an OpenAI list envelope
// `{ data: [{ embedding, index }], usage }`. The source lists both models
// statically and never asks Mixedbread for a model list.
//
// The fork has no `mixedbread` (or `mxbai`) provider, registry entry,
// EMBEDDING_ADAPTERS key or catalog row, so the provider definition, its model
// rows and the embeddings adapter are all staged here. The key is only ever
// sent to https://api.mixedbread.com.

export const MIXEDBREAD_PROVIDER_ID = "mixedbread";
// The source's provider-constants alias. The source embeddings route itself
// only resolves the `mixedbread/` prefix (EMBEDDING_PROVIDER_ALIASES has no
// mxbai entry); see registration.json for how registration may expose it.
export const MIXEDBREAD_ALIAS = "mxbai";
export const MIXEDBREAD_ORIGIN = "https://api.mixedbread.com";
export const MIXEDBREAD_EMBEDDINGS_URL = `${MIXEDBREAD_ORIGIN}/v1/embeddings`;
export const MIXEDBREAD_AUTH_HEADER = "Authorization";
export const MIXEDBREAD_AUTH_SCHEME = "Bearer";

/** The source's static list. Both models record a 1024-wide output. */
export const MIXEDBREAD_EMBEDDING_MODELS = Object.freeze([
  Object.freeze({ id: "mixedbread-ai/mxbai-embed-large-v1", name: "Mixedbread Embed Large v1", kind: "embedding", dimensions: 1024 }),
  Object.freeze({ id: "mixedbread-ai/mxbai-embed-2d-large-v1", name: "Mixedbread Embed 2D Large v1", kind: "embedding", dimensions: 1024 }),
]);

export const mixedbreadEmbeddingModel = (id) => MIXEDBREAD_EMBEDDING_MODELS.find((model) => model.id === id) ?? null;

/** Provider facts from the source constants, for the registration step. */
export const MIXEDBREAD_PROVIDER = Object.freeze({
  id: MIXEDBREAD_PROVIDER_ID,
  alias: MIXEDBREAD_ALIAS,
  name: "Mixedbread AI",
  website: "https://www.mixedbread.com",
  authType: "apikey",
  authHint: "Bearer API key for the Mixedbread embeddings API.",
  hasFree: true,
  freeNote: "Free-tier API key via signup, no credit card required.",
  existingServiceKinds: Object.freeze([]),
  serviceKinds: Object.freeze(["embedding"]),
});

/**
 * Staged registry entry in the fork's open-sse/providers/registry shape
 * (compare voyage-ai.js). Not imported anywhere: registration copies it into
 * open-sse/providers/registry/mixedbread.js. `embeddingConfig` carries the
 * fixed endpoint and auth for the key-validation probe and catalog; dispatch
 * must still go through the native adapter, never OPENAI_COMPAT_PROVIDERS.
 */
export const MIXEDBREAD_PROVIDER_DEFINITION = Object.freeze({
  id: MIXEDBREAD_PROVIDER_ID,
  alias: MIXEDBREAD_PROVIDER_ID,
  uiAlias: MIXEDBREAD_ALIAS,
  display: Object.freeze({
    name: "Mixedbread AI",
    icon: "hub",
    color: "#F59E0B",
    textIcon: "MB",
    website: "https://www.mixedbread.com",
    hasFree: true,
    freeNote: "Free-tier API key via signup, no credit card required.",
  }),
  category: "apikey",
  authType: "apikey",
  transport: null,
  models: MIXEDBREAD_EMBEDDING_MODELS.map(({ id, name, kind }) => Object.freeze({ id, name, kind })),
  serviceKinds: Object.freeze(["embedding"]),
  embeddingConfig: Object.freeze({ baseUrl: MIXEDBREAD_EMBEDDINGS_URL, authType: "apikey", authHeader: "bearer" }),
});

/** Client encodings served. Upstream answers floats; base64 is packed locally, as the source did. */
export const MIXEDBREAD_ENCODING_FORMATS = Object.freeze(["float", "base64"]);

// The source's per-item budget (MAX_EMBEDDING_INPUT_CHARS). The source cut
// longer strings silently; they are refused here instead.
export const MIXEDBREAD_MAX_INPUT_CHARS = 20_000;
// Not in the source. A conservative fork bound on one call's batch; it also
// bounds the answer (100 x 1024 floats).
export const MIXEDBREAD_MAX_INPUT_ITEMS = 100;
export const MIXEDBREAD_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
// The source used FETCH_TIMEOUT_MS per call and no body bound. One deadline
// here covers the send and the body read.
export const MIXEDBREAD_EMBEDDING_TIMEOUT_MS = 60_000;
