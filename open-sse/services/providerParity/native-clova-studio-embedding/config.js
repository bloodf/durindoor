// Naver CLOVA Studio native embeddings metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/embeddingRegistry.ts (`clova-studio`: id "clova-studio",
// baseUrl "https://clovastudio.stream.ntruss.com/v1/api-tools/embedding/v2",
// authType "apikey", authHeader "bearer", singleTextProtocol "clova-v2",
// models [{ id: "clova-embedding-v2", name: "CLOVA Embedding v2",
// dimensions: 1024 }]). Wire behavior comes from open-sse/handlers/embeddings.ts
// (resolveSingleTexts, fetchClovaEmbeddingBatch, appendClovaEmbedding) and
// open-sse/handlers/embeddingStructuredInput.ts
// (normalizeClovaEmbeddingV2Response): the endpoint embeds exactly one text per
// request, so a batch is fanned out into one sequential `POST` of `{ text }`
// per input with `Authorization: Bearer <apiKey || accessToken>` and
// `Content-Type: application/json`. Each answer is
// `{ status: { code: "20000", message }, result: { embedding: [...1024], inputTokens } }`;
// any other status code is a failure even on HTTP 200.
//
// The fork already has a `clova-studio` provider (alias `clova`,
// open-sse/providers/registry/clova-studio.js): API key, chat through the
// OpenAI-compatible https://clovastudio.stream.ntruss.com/v1/openai/chat/completions,
// serviceKinds ["llm"]. It has no embedding kind and no EMBEDDING_ADAPTERS key,
// so only the embeddings adapter and its model row are staged here. The key is
// only ever sent to https://clovastudio.stream.ntruss.com.

export const CLOVA_PROVIDER_ID = "clova-studio";
export const CLOVA_ALIAS = "clova";
export const CLOVA_ORIGIN = "https://clovastudio.stream.ntruss.com";
export const CLOVA_EMBEDDINGS_URL = `${CLOVA_ORIGIN}/v1/api-tools/embedding/v2`;
export const CLOVA_AUTH_HEADER = "Authorization";
export const CLOVA_AUTH_SCHEME = "Bearer";
/** The only success code in the v2 envelope (source: `String(status.code) !== "20000"` fails). */
export const CLOVA_SUCCESS_CODE = "20000";

/** Existing fork provider facts the registration step must keep, plus the kind it adds. */
export const CLOVA_PROVIDER = Object.freeze({
  id: CLOVA_PROVIDER_ID,
  alias: CLOVA_ALIAS,
  name: "Naver CLOVA Studio",
  website: "https://api.ncloud-docs.com/docs/en/ai-naver-clovastudio-summary",
  authType: "apikey",
  authHint: "Use your CLOVA Studio API key from clovastudio.ncloud.com. It is sent as Authorization: Bearer <key>.",
  existingServiceKinds: Object.freeze(["llm"]),
  serviceKinds: Object.freeze(["embedding"]),
});

/** The source's static list. The width is fixed; v2 has no `dimensions` parameter. */
export const CLOVA_EMBEDDING_MODELS = Object.freeze([
  Object.freeze({ id: "clova-embedding-v2", name: "CLOVA Embedding v2", kind: "embedding", dimensions: 1024 }),
]);

export const clovaEmbeddingModel = (id) => CLOVA_EMBEDDING_MODELS.find((model) => model.id === id) ?? null;

/** Client encodings served. Upstream always answers floats; base64 is packed locally, as the source did. */
export const CLOVA_ENCODING_FORMATS = Object.freeze(["float", "base64"]);

// The source's per-item budget (MAX_EMBEDDING_INPUT_CHARS). The source cut
// longer strings silently; they are refused here instead.
export const CLOVA_MAX_INPUT_CHARS = 20_000;
// Not in the source. Each input is its own sequential upstream call, so the
// batch is bounded to keep the total deadline meaningful.
export const CLOVA_MAX_INPUT_ITEMS = 64;
// One vector of 1024 floats is far below this; bounds each answer read.
export const CLOVA_MAX_RESPONSE_BYTES = 1024 * 1024;
// The source used FETCH_TIMEOUT_MS per call and no overall bound. Here each
// call (send and body read) has its own deadline and the whole fan-out has a
// total deadline; a call never gets more than what is left of the total.
export const CLOVA_CALL_TIMEOUT_MS = 30_000;
export const CLOVA_TOTAL_TIMEOUT_MS = 120_000;
