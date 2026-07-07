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

  // Generic OpenAI `/v1/models` catalog; keep all models with a string id
  "openai": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => typeof m.id === "string")
      .map((m) => ({ id: m.id, name: m.name || m.id })),


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
