// Upstage native embeddings metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/embeddingRegistry.ts (`upstage`: id "upstage", baseUrl
// "https://api.upstage.ai/v1/embeddings", authType "apikey", authHeader
// "bearer", models [{ id: "embedding-query", name: "Embedding Query",
// dimensions: 4096 }, { id: "embedding-passage", name: "Embedding Passage",
// dimensions: 4096 }]). Wire behavior comes from
// open-sse/handlers/embeddings.ts: one `POST` of `{ model, input }` (plus
// `dimensions` / `encoding_format` only when the client sent them) with
// `Authorization: Bearer <apiKey || accessToken>` and
// `Content-Type: application/json`, answered by an OpenAI list envelope
// `{ data: [{ embedding, index }], usage }`. The source lists both models
// statically; its provider models route merges them into the Upstage local
// catalog and never asks Upstage for an embedding model list.
//
// The fork already has an `upstage` provider (open-sse/providers/registry/
// upstage.js): API key, chat at https://api.upstage.ai/v1/chat/completions,
// no serviceKinds (defaults to ["llm"]). It has no embedding kind, no
// media.embeddingConfig and no EMBEDDING_ADAPTERS key, so only the embeddings
// adapter and its model rows are staged here. The key is only ever sent to
// https://api.upstage.ai.

export const UPSTAGE_PROVIDER_ID = "upstage";
export const UPSTAGE_ALIAS = "upstage";
export const UPSTAGE_ORIGIN = "https://api.upstage.ai";
export const UPSTAGE_EMBEDDINGS_URL = `${UPSTAGE_ORIGIN}/v1/embeddings`;
export const UPSTAGE_AUTH_HEADER = "Authorization";
export const UPSTAGE_AUTH_SCHEME = "Bearer";

/** Existing fork provider facts the registration step must keep, plus the kind it adds. */
export const UPSTAGE_PROVIDER = Object.freeze({
  id: UPSTAGE_PROVIDER_ID,
  alias: UPSTAGE_ALIAS,
  name: "Upstage",
  website: "https://www.upstage.ai",
  authType: "apikey",
  authHint: "Use your Upstage API key from console.upstage.ai. It is sent as Authorization: Bearer <key>.",
  existingServiceKinds: Object.freeze(["llm"]),
  serviceKinds: Object.freeze(["embedding"]),
});

/** The source's static list. Both Solar embedding models have a fixed 4096-wide output. */
export const UPSTAGE_EMBEDDING_MODELS = Object.freeze([
  Object.freeze({ id: "embedding-query", name: "Embedding Query", kind: "embedding", dimensions: 4096 }),
  Object.freeze({ id: "embedding-passage", name: "Embedding Passage", kind: "embedding", dimensions: 4096 }),
]);

export const upstageEmbeddingModel = (id) => UPSTAGE_EMBEDDING_MODELS.find((model) => model.id === id) ?? null;

/** Client encodings served. Upstream answers floats; base64 is packed locally, as the source did. */
export const UPSTAGE_ENCODING_FORMATS = Object.freeze(["float", "base64"]);

// The source's per-item budget (MAX_EMBEDDING_INPUT_CHARS). The source cut
// longer strings silently; they are refused here instead.
export const UPSTAGE_MAX_INPUT_CHARS = 20_000;
// Not in the source. A fork bound matching Upstage's documented batch size;
// it also bounds the answer (100 x 4096 floats).
export const UPSTAGE_MAX_INPUT_ITEMS = 100;
export const UPSTAGE_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
// The source used FETCH_TIMEOUT_MS per call and no body bound. One deadline
// here covers the send and the body read.
export const UPSTAGE_EMBEDDING_TIMEOUT_MS = 60_000;
