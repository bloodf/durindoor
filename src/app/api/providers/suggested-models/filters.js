import { isString } from "../../../../shared/utils/typeChecks.js";
import { isOpenRouterFreeModel, mapOpenRouterModel } from "open-sse/services/openrouterCatalog.js";
const KNOWN_FREE_OPENCODE_MODELS = [
"qwen/qwen2.5-coder-32b-instruct",
"deepseek/deepseek-chat",
"meta-llama/llama-3.3-70b-instruct"];


// Catalogs do not consistently label chat models, and some valid providers
// return opaque IDs. Reject only explicit non-chat families; an unknown string
// ID remains selectable so providers such as B.ai do not render an empty list.
const NON_CHAT_MODEL_RE = /(?:dall-e|whisper|text-embedding|tts(?:-|$)|moderation|rerank|embed|image|audio|speech|(?:^|[/_-])bge(?:[/_-]|$))/i;

export const FILTERS = {
  // OpenRouter /api/v1/models: keep free models (`:free` id and zero pricing,
  // see isOpenRouterFreeModel) and carry the published context window.
  "openrouter-free": (models) =>
  (Array.isArray(models) ? models : []).
  filter(isOpenRouterFreeModel).
  map(mapOpenRouterModel).
  filter((m) => m && !m.kind).
  map((m) => {
    const entry = { id: m.id, name: m.name };
    if (m.capabilities.contextWindow) entry.contextLength = m.capabilities.contextWindow;
    return entry;
  }),

  // Opencode /zen/v1/models returns an array of { id, name? } objects; keep only free models.
  "opencode-free": (models) =>
  models.
  filter((m) => m.id?.endsWith("-free") || KNOWN_FREE_OPENCODE_MODELS.includes(m.id)).
  map((m) => ({ id: m.id, name: m.id })),

  // OpenAI /v1/models or any chat-compatible catalog that returns an array of { id, object, ... }.
  // We strip non-chat model families (embeddings, image, TTS, audio, moderation, rerank) so the
  // dashboard model picker only shows chat-capable models. hcnsec's live catalog returns many
  // non-chat models (speech, image, embedding, etc.), which is why this filter exists. See PR #70.
  "openai": (models) => {
    const raw = Array.isArray(models) ? models : [];
    return raw.
    filter((m) => {
      if (!isString(m.id) || !m.id) return false;
      const kind = String(m.type || m.kind || m.task || "").toLowerCase();
      const id = m.id.toLowerCase();
      return !NON_CHAT_MODEL_RE.test(kind) && !NON_CHAT_MODEL_RE.test(id);
    }).
    map((m) => ({ id: m.id, name: m.name || m.id, ...(m.context_length != null ? { contextLength: m.context_length } : null) }));
  },

  // Plain OpenAI-compatible /v1/models list (Crof, DIT, FreeAIAPIKey, hcnsec, …):
  // { data: [{ id, context_length? }] } → dashboard's { id, name, contextLength? }.
  "openai-compatible": (models) =>
  (Array.isArray(models) ? models : []).
  filter((m) => m?.id).
  map((m) => ({
    id: m.id,
    name: m.name || m.id,
    ...(m.context_length != null ? { contextLength: m.context_length } : null)
  })),

  // models.dev returns a large catalog; keep only mimo models
  "mimo-free": (models) =>
  (Array.isArray(models) ? models : []).
  filter((m) => m.id?.startsWith("mimo") || m.name?.toLowerCase().includes("mimo")).
  map((m) => ({ id: m.id, name: m.name || m.id }))
};