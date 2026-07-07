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
        if (typeof m.id !== "string") return false;
        const kind = String(m.type || m.kind || m.task || "").toLowerCase();
        const id = m.id.toLowerCase();
        if (kind.includes("embedding") || kind.includes("image") || kind.includes("tts") || kind.includes("audio") || kind.includes("speech") || kind.includes("moderation") || kind.includes("rerank")) return false;
        if (id.includes("embed") || id.includes("image") || id.includes("tts") || id.includes("audio") || id.includes("speech") || id.includes("moderation") || id.includes("rerank")) return false;
        const chatPrefixes = ["gpt-", "chat-", "deepseek-", "qwen", "claude", "llama", "mistral", "gemini", "mixtral", "yi-", "internlm", "command-r", "command", "orca", "phi", "solar", "starling", "vicuna", "wizardlm", "zephyr"];
        const isChat = chatPrefixes.some((prefix) => new RegExp("(^|[/-])" + prefix).test(id));
        if (kind.includes("chat") || kind.includes("llm") || kind.includes("text-generation") || kind.includes("language-model") || isChat) return true;
        return false; // reject unknown model kinds to avoid offering non-chat ids in chat picker
      })
      .map((m) => ({ id: m.id, name: m.name || m.id }));
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
