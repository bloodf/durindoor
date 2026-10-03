import { isString } from "../../src/shared/utils/typeChecks.js";
import REGISTRY from "./registry/index.js";
import { SYSTEMONE_COMPATIBLE_PREFIX } from "../config/systemone.js";

const findEntry = (provider) =>
  REGISTRY.find((e) => e.id === provider || e.alias === provider || e.aliases?.includes(provider));

/**
 * Whether a provider can serve chat requests. A registry provider with no chat
 * transport whose service kinds exclude `llm` (System One engines such as
 * Laya, TTS/STT/search/image-only providers) cannot: the executor lookup would
 * fall back to the OpenAI default and send the prompt, and the connection's
 * key, to api.openai.com. Only chat-compatible custom nodes may pass.
 */
export function isChatProvider(provider) {
  if (isString(provider) && provider.startsWith(SYSTEMONE_COMPATIBLE_PREFIX)) return false;
  const entry = findEntry(provider);
  if (!entry) return true;
  const kinds = Array.isArray(entry.serviceKinds) ? entry.serviceKinds : ["llm"];
  return !!entry.transport || kinds.includes("llm");
}

/** Models whose native endpoint is not a chat-completions transport. */
export function isNativeOnlyModel(provider, model) {
  if (isString(provider) && provider.startsWith(SYSTEMONE_COMPATIBLE_PREFIX)) return true;
  const entry = findEntry(provider)?.models?.find((candidate) => candidate.id === model || candidate.aliases?.includes(model));
  return ["systemone", "embedding", "rerank", "stt", "tts", "video", "music", "realtime", "realtimeTranslation", "realtimeTranscription", "live", "documentParsing"].includes(entry?.kind ?? entry?.type);
}
