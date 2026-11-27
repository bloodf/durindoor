import { createMediaRegistry, lookupMediaAdapter } from "../mediaRegistry.js";
// Embeddings provider adapter registry
import createOpenAIEmbeddingAdapter from "./openai.js";
import cloudflare from "./cloudflare.js";
import cohere from "./cohere.js";
import gemini from "./gemini.js";
import github from "./github.js";
import openaiCompatNode from "./openaiCompatNode.js";
import ollamaLocal from "./ollama-local.js";
import { deepinfraEmbeddingAdapter } from "../../services/providerParity/native-deepinfra-embedding-rerank/index.js";

const OPENAI_COMPAT_PROVIDERS = [
  "paraloncloud", "morph",
  "openai", "openrouter", "mistral", "voyage-ai", "fireworks",
  "together", "nebius", "nvidia", "jina-ai",
  "vercel-ai-gateway", "venice", "nan",
];

export const EMBEDDING_ADAPTERS = createMediaRegistry({
  ...Object.fromEntries(OPENAI_COMPAT_PROVIDERS.map((id) => [id, createOpenAIEmbeddingAdapter(id)])),
  "cloudflare-ai": cloudflare,
  cohere,
  gemini,
  github,
  google_ai_studio: gemini,
  "ollama-local": ollamaLocal,
  // Marks DeepInfra as an embedding transport. embeddingsCore sends DeepInfra
  // through the bounded native service, never through the generic fetch below.
  deepinfra: deepinfraEmbeddingAdapter,
});

export function getEmbeddingAdapter(provider) {
  const adapter = lookupMediaAdapter(EMBEDDING_ADAPTERS, provider);
  if (adapter) return adapter;
  if (provider?.startsWith?.("openai-compatible-") || provider?.startsWith?.("custom-embedding-")) {
    return openaiCompatNode;
  }
  return null;
}
