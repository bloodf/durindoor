// Embeddings provider adapter registry
import createOpenAIEmbeddingAdapter from "./openai.js";
import cloudflare from "./cloudflare.js";
import cohere from "./cohere.js";
import gemini from "./gemini.js";
import github from "./github.js";
import openaiCompatNode from "./openaiCompatNode.js";
import ollamaLocal from "./ollama-local.js";

const OPENAI_COMPAT_PROVIDERS = [
  "openai", "openrouter", "mistral", "voyage-ai", "fireworks",
  "together", "nebius", "nvidia", "jina-ai",
  "vercel-ai-gateway", "venice",
];

const ADAPTERS = {
  ...Object.fromEntries(OPENAI_COMPAT_PROVIDERS.map((id) => [id, createOpenAIEmbeddingAdapter(id)])),
  "cloudflare-ai": cloudflare,
  cohere,
  gemini,
  github,
  google_ai_studio: gemini,
  "ollama-local": ollamaLocal,
};

export function getEmbeddingAdapter(provider) {
  if (ADAPTERS[provider]) return ADAPTERS[provider];
  if (provider?.startsWith?.("openai-compatible-") || provider?.startsWith?.("custom-embedding-")) {
    return openaiCompatNode;
  }
  return null;
}
