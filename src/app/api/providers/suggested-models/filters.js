const KNOWN_FREE_OPENROUTER_MODELS = [
  "openai/gpt-3.5-turbo",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "anthropic/claude-3.5-sonnet",
  "google/gemini-flash-1.5",
  "meta-llama/llama-3.1-8b-instruct",
  "deepseek/deepseek-chat",
  "nousresearch/hermes-3-llama-3.1-405b",
  "qwen/qwen-2.5-72b-instruct",
  "mistralai/mistral-nemo",
];

const KNOWN_FREE_OPENCODE_MODELS = [
  "qwen/qwen2.5-coder-32b-instruct",
  "deepseek/deepseek-chat",
  "meta-llama/llama-3.3-70b-instruct",
];

// Catalogs do not consistently label chat models, and some valid providers
// return opaque IDs. Reject only explicit non-chat families; an unknown string
// ID remains selectable so providers such as B.ai do not render an empty list.
const NON_CHAT_MODEL_RE = /(?:dall-e|whisper|text-embedding|tts(?:-|$)|moderation|rerank|embed|image|audio|speech|(?:^|[/_-])bge(?:[/_-]|$))/i;

export const FILTERS = {
  // OpenRouter /api/v1/models — returns standard OpenAI-style objects; keep free ones.
  "openrouter-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => m.id && KNOWN_FREE_OPENROUTER_MODELS.includes(m.id))
      .map((m) => ({ id: m.id, name: m.name || m.id })),

  // Opencode /zen/v1/models returns an array of { id, name? } objects; keep only free models.
  "opencode-free": (models) =>
    models
      .filter((m) => m.id?.endsWith("-free") || KNOWN_FREE_OPENCODE_MODELS.includes(m.id))
      .map((m) => ({ id: m.id, name: m.id })),

  // OpenAI /v1/models or any chat-compatible catalog that returns an array of { id, object, ... }.
  // We strip non-chat model families (embeddings, image, TTS, audio, moderation, rerank) so the
  // dashboard model picker only shows chat-capable models. hcnsec's live catalog returns many
  // non-chat models (speech, image, embedding, etc.), which is why this filter exists. See PR #70.
  "openai": (models) => {
    const raw = Array.isArray(models) ? models : [];
    return raw
      .filter((m) => {
        if (typeof m.id !== "string" || !m.id) return false;
        const kind = String(m.type || m.kind || m.task || "").toLowerCase();
        const id = m.id.toLowerCase();
        return !NON_CHAT_MODEL_RE.test(kind) && !NON_CHAT_MODEL_RE.test(id);
      })
      .map((m) => ({ id: m.id, name: m.name || m.id, ...(m.context_length != null ? { contextLength: m.context_length } : {}) }));
  },

  // Plain OpenAI-compatible /v1/models list (Crof, DIT, FreeAIAPIKey, hcnsec, …):
  // { data: [{ id, context_length? }] } → dashboard's { id, name, contextLength? }.
  "openai-compatible": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => m?.id)
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        ...(m.context_length != null ? { contextLength: m.context_length } : {}),
      })),

  // models.dev returns a large catalog; keep only mimo models
  "mimo-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => m.id?.startsWith("mimo") || m.name?.toLowerCase().includes("mimo"))
      .map((m) => ({ id: m.id, name: m.name || m.id })),
};
