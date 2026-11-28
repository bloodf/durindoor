export const OPENROUTER_QUANTIZATIONS = [
  "int4", "int8", "fp4", "mxfp4", "nvfp4", "fp6", "fp8", "mxfp8",
  "fp16", "bf16", "fp32", "unknown",
];

export const OPENROUTER_PRECISION_PRESETS = {
  unrestricted: [],
  eightBit: ["int8", "fp8", "fp16", "bf16", "fp32"],
  sixteenBit: ["fp16", "bf16", "fp32"],
};

export const OPENROUTER_QUANTIZATION_FAMILIES = {
  fp4: ["fp4", "mxfp4", "nvfp4"],
  fp8: ["fp8", "mxfp8"],
};

// Proprietary families whose serving precision is not published. Match models,
// not entire vendors: GPT-OSS and Gemma must still obey the precision policy.
// ponytail: explicit families only; extend when another family is verified.
export const OPENROUTER_UNDISCLOSED_PRECISION_MODELS = [
  /^anthropic\/claude(?:-|$)/,
  /^openai\/(?:gpt-(?!oss(?:-|:|$))|chatgpt-|o[1-9](?:-|:|$)|text-embedding-)/,
  /^google\/gemini-/,
  /^x-ai\/grok-(?:[3-9](?:[.:-]|$)|build-)/,
];

export const OPENROUTER_ROUTING_ENDPOINTS = {
  completion: { precision: true, zdr: true },
  embedding: { precision: true, zdr: true },
  systemone: { precision: true, zdr: true },
  image: { exception: "allowImageWithoutZdr", reason: "ZDR enforcement for dedicated image generation is not verified" },
  video: { exception: "allowVideoWithoutZdr", reason: "OpenRouter video generation is not eligible for ZDR" },
};

export default {
  id: "openrouter",
  priority: 10,
  hasFree: true,
  alias: "openrouter",
  display: {
    name: "OpenRouter",
    icon: "router",
    color: "#F97316",
    textIcon: "OR",
    website: "https://openrouter.ai",
    notice: {
      text: "Free tier: `:free` models, no credit card needed, 20 req/min and 50 req/day. After buying $10+ in credits: 1,000 req/day.",
      apiKeyUrl: "https://openrouter.ai/settings/keys",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    thinkingFormat: "openai",
    headers: {
      "HTTP-Referer": "https://endpoint-proxy.local",
      "X-Title": "Endpoint Proxy",
    },
  },
  models: [
    { id: "openai/text-embedding-3-large", name: "OpenAI Text Embedding 3 Large", kind: "embedding" },
    { id: "openai/text-embedding-3-small", name: "OpenAI Text Embedding 3 Small", kind: "embedding" },
    { id: "openai/text-embedding-ada-002", name: "OpenAI Text Embedding Ada 002", kind: "embedding" },
    { id: "qwen/qwen3-embedding-8b", name: "Qwen3 Embedding 8B", kind: "embedding" },
    { id: "perplexity/pplx-embed-v1-4b", name: "Perplexity Embed V1 4B", kind: "embedding" },
    { id: "perplexity/pplx-embed-v1-0.6b", name: "Perplexity Embed V1 0.6B", kind: "embedding" },
    { id: "nvidia/llama-nemotron-embed-vl-1b-v2:free", name: "NVIDIA Nemotron Embed VL 1B V2 (Free)", kind: "embedding" },
    { id: "openai/gpt-4o-mini-tts", name: "GPT-4o Mini TTS", kind: "tts" },
    { id: "openai/tts-1-hd", name: "TTS-1 HD", kind: "tts" },
    { id: "openai/tts-1", name: "TTS-1", kind: "tts" },
    { id: "openai/dall-e-3", name: "DALL-E 3 (via OpenRouter)", params: ["size","quality","style","response_format"], kind: "image" },
    { id: "openai/gpt-image-1", name: "GPT Image 1 (via OpenRouter)", params: ["n","size","quality","response_format"], kind: "image" },
    { id: "google/imagen-3.0-generate-002", name: "Imagen 3 (via OpenRouter)", params: ["n","size"], kind: "image" },
    { id: "black-forest-labs/FLUX.1-schnell", name: "FLUX.1 Schnell (via OpenRouter)", params: ["n","size"], kind: "image" },
    // OpenRouter exposes a separate, Cohere-compatible POST /api/v1/rerank endpoint
    // (not surfaced by its live /v1/models feed). Model IDs keep their vendor slash
    // (e.g. "cohere/rerank-4-pro"); the model parser splits on the first slash, so
    // 3-segment ids resolve safely. Seeded by hand as OpenRouter adds rerank models.
    { id: "cohere/rerank-4-pro", name: "Cohere Rerank 4 Pro (via OpenRouter)", kind: "rerank" },
    { id: "cohere/rerank-4-fast", name: "Cohere Rerank 4 Fast (via OpenRouter)", kind: "rerank" },
    { id: "cohere/rerank-v3.5", name: "Cohere Rerank v3.5 (via OpenRouter)", kind: "rerank" },
    { id: "nvidia/llama-nemotron-rerank-vl-1b-v2:free", name: "Llama Nemotron Rerank VL 1B v2 (free, via OpenRouter)", kind: "rerank" },
    { id: "typesafe/jev-1.13", name: "Jev 1.13", kind: "systemone" },
  ],
  serviceKinds: ["llm","embedding","tts","imageToText","rerank","systemone"],
  // System One decision API (TypeSafe-compatible): https://openrouter.ai/docs/guides/community/typesafe-sdk
  systemoneConfig: {
    baseUrl: "https://openrouter.ai/api/v1/systemone",
    headers: {"HTTP-Referer":"https://endpoint-proxy.local","X-Title":"Endpoint Proxy"},
  },
  ttsConfig: {
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openai/gpt-4o-mini-tts",
    headers: {"HTTP-Referer":"https://endpoint-proxy.local","X-Title":"Endpoint Proxy"},
  },
  embeddingConfig: {
    baseUrl: "https://openrouter.ai/api/v1/embeddings",
    authType: "apikey",
    authHeader: "bearer",
    headers: {"HTTP-Referer":"https://endpoint-proxy.local","X-Title":"Endpoint Proxy"},
  },
  imageConfig: {
    baseUrl: "https://openrouter.ai/api/v1/images/generations",
    headers: {"HTTP-Referer":"https://endpoint-proxy.local","X-Title":"Endpoint Proxy"},
  },
  modelsFetcher: { url: "https://openrouter.ai/api/v1/models", type: "openrouter-free" },
  passthroughModels: true,
};
