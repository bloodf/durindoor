import { bearerAuth } from "./_base.js";

const URL = "https://api.cohere.com/v2/embed";

export default {
  buildUrl: () => URL,
  buildHeaders: (credentials) => ({ "Content-Type": "application/json", ...bearerAuth(credentials) }),
  buildBody: (model, { input, dimensions, input_type }) => ({
    model,
    input_type,
    texts: Array.isArray(input) ? input : [input],
    embedding_types: ["float"],
    ...(Number.isFinite(Number(dimensions)) && Number(dimensions) > 0 ? { output_dimension: Number(dimensions) } : null),
  }),
  normalize: (responseBody, model) => {
    const vectors = responseBody?.embeddings?.float;
    if (!Array.isArray(vectors) || vectors.some((vector) => !Array.isArray(vector) || vector.length === 0 || vector.some((value) => !Number.isFinite(value)))) {
      throw new Error("Invalid Cohere float embeddings response");
    }
    const tokens = responseBody?.meta?.tokens?.input_tokens;
    return {
      object: "list",
      data: vectors.map((embedding, index) => ({ object: "embedding", index, embedding })),
      model,
      ...(Number.isFinite(tokens) && tokens >= 0 ? { usage: { prompt_tokens: tokens, total_tokens: tokens } } : null)
    };
  },
};
