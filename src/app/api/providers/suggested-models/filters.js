// Free OpenCode models that don't use the "-free" id suffix
const KNOWN_FREE_OPENCODE_MODELS = ["big-pickle"];

export const FILTERS = {
  "openrouter-free": (models) =>
    models
      .filter(
        (m) =>
          m.pricing?.prompt === "0" &&
          m.pricing?.completion === "0" &&
          m.context_length >= 200000
      )
      .map((m) => ({ id: m.id, name: m.name, contextLength: m.context_length }))
      .sort((a, b) => b.contextLength - a.contextLength),

  "opencode-free": (models) =>
    models
      .filter((m) => m.id?.endsWith("-free") || KNOWN_FREE_OPENCODE_MODELS.includes(m.id))
      .map((m) => ({ id: m.id, name: m.id })),

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
        const isChat = chatPrefixes.some((prefix) => id.startsWith(prefix));
        if (kind.includes("chat") || kind.includes("llm") || kind.includes("text-generation") || kind.includes("language-model") || isChat) return true;
        return false; // reject unknown model kinds to avoid offering non-chat ids in chat picker
      })
      .map((m) => ({ id: m.id, name: m.name || m.id }));
  },


  // models.dev returns a large catalog; keep only mimo models
  "mimo-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => m.id?.startsWith("mimo") || m.name?.toLowerCase().includes("mimo"))
      .map((m) => ({ id: m.id, name: m.name || m.id })),

  // Plain OpenAI-compatible /v1/models list (Crof, DIT, FreeAIAPIKey, …):
  // { data: [{ id, context_length? }] } → dashboard's { id, name, contextLength? }.
  openai: (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => m?.id)
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        ...(m.context_length != null ? { contextLength: m.context_length } : {}),
      })),
};
