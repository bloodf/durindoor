// deAPI native embeddings metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/embeddingRegistry.ts (`deapi`: id "deapi", baseUrl
// "https://oai.deapi.ai/v1/embeddings", authType "apikey", authHeader
// "bearer", models [{ id: "Bge_M3_FP16", name: "BGE-M3 (deAPI)", dimensions:
// 1024 }]). Wire behavior comes from open-sse/handlers/embeddings.ts: one
// `POST` of `{ model, input, encoding_format? }` with
// `Authorization: Bearer <apiKey || accessToken>` and
// `Content-Type: application/json`, answered by an OpenAI list envelope
// `{ data: [{ embedding, index }], usage }`. The source lists the model
// statically; it has no deAPI model discovery.
//
// The fork has no `deapi` provider anywhere today (no registry entry, no
// catalog row, no EMBEDDING_ADAPTERS key), so the provider metadata below is
// staged here too. The key is only ever sent to https://oai.deapi.ai.

export const DEAPI_PROVIDER_ID = "deapi";
export const DEAPI_ALIAS = "deapi";
export const DEAPI_ORIGIN = "https://oai.deapi.ai";
export const DEAPI_EMBEDDINGS_URL = `${DEAPI_ORIGIN}/v1/embeddings`;
export const DEAPI_AUTH_HEADER = "Authorization";
export const DEAPI_AUTH_SCHEME = "Bearer";

/** Catalog metadata for the registration step (source specialty-media entry). */
export const DEAPI_PROVIDER = Object.freeze({
  id: DEAPI_PROVIDER_ID,
  alias: DEAPI_ALIAS,
  name: "deAPI",
  website: "https://deapi.ai",
  authType: "apikey",
  authHint: "Use your deAPI API key from deapi.ai. It is sent as Authorization: Bearer <key>.",
  serviceKinds: Object.freeze(["embedding"]),
});

/** The source's static list. BGE-M3 has a fixed 1024-wide output. */
export const DEAPI_EMBEDDING_MODELS = Object.freeze([
  Object.freeze({ id: "Bge_M3_FP16", name: "BGE-M3 (deAPI)", kind: "embedding", dimensions: 1024 }),
]);

export const deapiEmbeddingModel = (id) => DEAPI_EMBEDDING_MODELS.find((model) => model.id === id) ?? null;

/** Client encodings served. Upstream is always asked for floats; base64 is packed locally, as the source did. */
export const DEAPI_ENCODING_FORMATS = Object.freeze(["float", "base64"]);

// The source's per-item budget (MAX_EMBEDDING_INPUT_CHARS). The source cut
// longer strings silently; they are refused here instead.
export const DEAPI_MAX_INPUT_CHARS = 20_000;
// Not in the source. Bounds the request and the answer size together.
export const DEAPI_MAX_INPUT_ITEMS = 256;
export const DEAPI_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
// The source used FETCH_TIMEOUT_MS per call and no body bound. One deadline
// here covers the send and the body read.
export const DEAPI_EMBEDDING_TIMEOUT_MS = 60_000;
