// Free OpenCode models that don't use the "-free" id suffix
const KNOWN_FREE_OPENCODE_MODELS = ["big-pickle"];

export const FILTERS = {
  // Ollama Cloud / local Ollama fetch suggested models: `/api/tags` returns
  // { models: [{ name }] } — return `name` as both id and name.
  ollama: (models) =>
    (Array.isArray(models) ? models : [])
      .map((m) => {
        const name = typeof m.name === "string" ? m.name : m.id || "";
        return { id: name, name };
      })
      .filter((m) => m.id),

  // Plain OpenAI-compatible /v1/models list (modelscope, openadapter, kenari,
  // novita, venice, vercel-ai-gateway, ...) — no free/pricing filter, just
  // reshape { data: [{ id, ... }] } into { id, name }.
  openai: (models) =>
    (Array.isArray(models) ? models : []).map((m) => ({ id: m.id, name: m.id })),

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

  // models.dev returns a large catalog; keep only mimo models
  "mimo-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => m.id?.startsWith("mimo") || m.name?.toLowerCase().includes("mimo"))
      .map((m) => ({ id: m.id, name: m.name || m.id })),
};
