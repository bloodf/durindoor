// NanoGPT native embeddings metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/embeddingRegistry.ts (`nanogpt`: id "nanogpt", baseUrl
// "https://nano-gpt.com/v1/embeddings", authType "apikey", authHeader
// "bearer", models [{ id: "text-embedding-3-small", name: "Text Embedding 3
// Small", dimensions: 1536 }, { id: "text-embedding-3-large", name: "Text
// Embedding 3 Large", dimensions: 3072 }]). Wire behavior comes from
// open-sse/handlers/embeddings.ts: one `POST` of
// `{ model, input, dimensions?, encoding_format? }` with
// `Authorization: Bearer <apiKey || accessToken>` and
// `Content-Type: application/json`, answered by an OpenAI list envelope
// `{ data: [{ embedding, index }], usage }`. The source lists the embedding
// models statically. Its NanoGPT model discovery (providerSets.ts, the chat
// catalog at /api/v1/models) does not feed the embedding registry.
//
// The fork already has a `nanogpt` provider (open-sse/providers/registry/
// nanogpt.js): API key, chat at https://nano-gpt.com/api/v1/chat/completions,
// serviceKinds ["llm"]. It has no embedding kind and no EMBEDDING_ADAPTERS key,
// so only the embeddings adapter and its model rows are staged here. The
// embeddings path is /v1/embeddings (not /api/v1), exactly as the source pins
// it. The key is only ever sent to https://nano-gpt.com.

export const NANOGPT_PROVIDER_ID = "nanogpt";
export const NANOGPT_ALIAS = "nanogpt";
export const NANOGPT_ORIGIN = "https://nano-gpt.com";
export const NANOGPT_EMBEDDINGS_URL = `${NANOGPT_ORIGIN}/v1/embeddings`;
export const NANOGPT_AUTH_HEADER = "Authorization";
export const NANOGPT_AUTH_SCHEME = "Bearer";

/** Existing fork provider facts the registration step must keep, plus the kind it adds. */
export const NANOGPT_PROVIDER = Object.freeze({
  id: NANOGPT_PROVIDER_ID,
  alias: NANOGPT_ALIAS,
  name: "NanoGPT",
  website: "https://nano-gpt.com",
  authType: "apikey",
  authHint: "Use your NanoGPT API key from nano-gpt.com. It is sent as Authorization: Bearer <key>.",
  existingServiceKinds: Object.freeze(["llm"]),
  serviceKinds: Object.freeze(["embedding"]),
});

/** The source's static list. `dimensions` is each model's full (default) width. */
export const NANOGPT_EMBEDDING_MODELS = Object.freeze([
  Object.freeze({ id: "text-embedding-3-small", name: "Text Embedding 3 Small", kind: "embedding", dimensions: 1536 }),
  Object.freeze({ id: "text-embedding-3-large", name: "Text Embedding 3 Large", kind: "embedding", dimensions: 3072 }),
]);

export const nanogptEmbeddingModel = (id) => NANOGPT_EMBEDDING_MODELS.find((model) => model.id === id) ?? null;

/** Client encodings served. Upstream is always asked for floats; base64 is packed locally, as the source did. */
export const NANOGPT_ENCODING_FORMATS = Object.freeze(["float", "base64"]);

// The source's per-item budget (MAX_EMBEDDING_INPUT_CHARS). The source cut
// longer strings silently; they are refused here instead.
export const NANOGPT_MAX_INPUT_CHARS = 20_000;
// Not in the source. Bounds the request and the answer size together.
export const NANOGPT_MAX_INPUT_ITEMS = 256;
export const NANOGPT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
// The source used FETCH_TIMEOUT_MS per call and no body bound. One deadline
// here covers the send and the body read.
export const NANOGPT_EMBEDDING_TIMEOUT_MS = 60_000;
