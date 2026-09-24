import REGISTRY from "./registry/index.js";

const findEntry = (provider) =>
  REGISTRY.find((e) => e.id === provider || e.alias === provider || e.aliases?.includes(provider));

/**
 * Whether a provider can serve chat requests. A registry provider with no chat
 * transport whose service kinds exclude `llm` (System One engines such as
 * Laya, TTS/STT/search/image-only providers) cannot: the executor lookup would
 * fall back to the OpenAI default and send the prompt, and the connection's
 * key, to api.openai.com. Unknown providers (custom nodes) pass.
 */
export function isChatProvider(provider) {
  const entry = findEntry(provider);
  if (!entry) return true;
  const kinds = Array.isArray(entry.serviceKinds) ? entry.serviceKinds : ["llm"];
  return !!entry.transport || kinds.includes("llm");
}

/** A registry model that is a System One decision model, not a chat model. */
export function isSystemoneModel(provider, model) {
  const m = findEntry(provider)?.models?.find((x) => x.id === model);
  return (m?.kind ?? m?.type) === "systemone";
}
