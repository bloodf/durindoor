// Ollama Local embeddings adapter — normalizes Ollama /api/embed to OpenAI shape.
import { resolveOllamaLocalHost } from "../../config/providers.js";
import { isNumber } from "@/shared/utils/typeChecks.js";

export default {
  buildUrl: (_model, creds) => `${resolveOllamaLocalHost(creds)}/api/embed`,
  buildHeaders: () => ({ "Content-Type": "application/json" }),
  buildBody: (model, { input, dimensions }) => {
    const body = { model, input };
    if (isNumber(dimensions) && Number.isFinite(dimensions) && dimensions > 0) {
      body.dimensions = dimensions;
    }
    return body;
  },
  normalize: (responseBody, model) => {
    const embeddings = Array.isArray(responseBody?.embeddings) ? responseBody.embeddings : [];
    const promptTokens =
    isNumber(responseBody?.prompt_eval_count) && Number.isFinite(responseBody.prompt_eval_count) && responseBody.prompt_eval_count >= 0 ?
    responseBody.prompt_eval_count :
    0;
    return {
      object: "list",
      data: embeddings.map((embedding, index) => ({
        object: "embedding",
        index,
        embedding: Array.isArray(embedding) ? embedding : []
      })),
      model: responseBody?.model || model,
      usage: {
        prompt_tokens: promptTokens,
        total_tokens: promptTokens
      }
    };
  }
};