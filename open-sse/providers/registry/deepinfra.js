import { DEEPINFRA_VIDEO_MODELS } from "../../services/providerParity/native-deepinfra-video/config.js";
import { embeddingModels, rerankModels } from "../../services/providerParity/native-deepinfra-embedding-rerank/config.js";

export default {
  id: "deepinfra",
  alias: "deepinfra",
  display: {
    name: "DeepInfra",
    icon: "memory",
    color: "#111827",
    textIcon: "DI",
    website: "https://deepinfra.com",
    notice: {
      apiKeyUrl: "https://deepinfra.com/dash/api_keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.deepinfra.com/v1/openai/chat/completions",
    authHeader: "bearer",
    validateUrl: "https://api.deepinfra.com/v1/openai/models",
    thinkingFormat: "openai",
  },
  // Public /models lists the chat models and changes faster than a curated
  // snapshot. The rows below are the pinned native media catalogs only; the
  // chat fetcher never feeds them and they never appear as chat models.
  models: [
    ...DEEPINFRA_VIDEO_MODELS.map(({ id, name }) => ({ id, name, kind: "video" })),
    ...embeddingModels.map(({ id, name, dimensions }) => ({ id, name, kind: "embedding", dimensions })),
    ...rerankModels.map(({ id, name }) => ({ id, name, kind: "rerank" })),
  ],
  // Video: synchronous /v1/inference adapter in videoProviders (no videoConfig).
  // Embeddings and rerank: the bounded native service, dispatched before the
  // generic OpenAI-compatible cores (the derived /v1/openai/rerank is not used).
  serviceKinds: ["llm", "video", "embedding", "rerank"],
  modelsFetcher: { url: "https://api.deepinfra.com/v1/openai/models", type: "openai" },
  passthroughModels: true,
};
