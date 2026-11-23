import { AI_PROVIDERS, isLocalOllamaProvider } from "@/shared/constants/providers";
import { isString } from "../../../../shared/utils/typeChecks.js";

export const LLM_KIND = "llm";

// Map per-model `type` field (in PROVIDER_MODELS) to service kind.
// Models without `type` are treated as LLM.
const MODEL_TYPE_TO_KIND = {
  image: "image",
  tts: "tts",
  embedding: "embedding",
  stt: "stt",
  imageToText: "imageToText",
  rerank: "rerank",
  video: "video",
  music: "music",
  realtime: "realtime",
  audio: "audio",
  realtimeTranslation: "realtimeTranslation",
  realtimeTranscription: "realtimeTranscription",
  live: "live",
  moderation: "moderation",
  systemone: "systemone",
  documentParsing: "documentParsing"
};

export function modelKind(model) {
  const k = model?.kind || model?.type;
  if (!k) return LLM_KIND;
  return MODEL_TYPE_TO_KIND[k] ?? LLM_KIND;
}

// For dynamic/unknown model IDs (compatible providers, alias map, custom models)
// fall back to provider-level kind matching when per-model type is unavailable.
export function inferKindFromUnknownModelId(modelId) {
  const lower = String(modelId).toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/transcribe|whisper|^asr-/.test(lower)) return "stt";
  if (/realtime|voice-agent/.test(lower)) return "realtime";
  if (/^music-/.test(lower)) return "music";
  if (/moderation/.test(lower)) return "moderation";
  if (/sora|hailuo|^minimax-h3|grok-imagine-video/.test(lower)) return "video";
  if (/tts|^speech-|text-to-speech/.test(lower)) return "tts";
  if (/image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion/.test(lower)) return "image";
  return LLM_KIND;
}

export function customModelKind(m, defaultKind = LLM_KIND) {
  const raw = m.kind || m.type;
  if (!isString(raw)) return defaultKind;
  return MODEL_TYPE_TO_KIND[raw] ?? defaultKind;
}

export function getCompatiblePublicIds({ customModelIds, modelAliases, providerId, staticAlias, outputAlias }) {
  const prefixes = new Set([providerId, staticAlias, outputAlias].filter((value) => isString(value) && value));
  const aliasIds = Object.values(modelAliases).flatMap((fullModel) => {
    if (!isString(fullModel)) return [];
    for (const prefix of prefixes) {
      if (fullModel.startsWith(`${prefix}/`)) {
        const modelId = fullModel.slice(prefix.length + 1).trim();
        return modelId ? [modelId] : [];
      }
    }
    return [];
  });
  return { ids: customModelIds, aliasIds };
}


/**
 * Fetch model IDs for passthrough local providers (lm-studio, vllm, lemonade)
 * by hitting the connection's baseUrl (or provider defaultBaseUrl) + /models.
 * Sends Authorization: Bearer apiKey when the connection has one so gated
 * deployments still respond.
 */
export function providerMatchesKinds(providerId, kindFilter) {
  if (isLocalOllamaProvider(providerId) && kindFilter.includes("embedding")) return true;
  const provider = AI_PROVIDERS[providerId];
  const serviceKinds = provider?.serviceKinds;
  const kinds = Array.isArray(serviceKinds) && serviceKinds.length > 0 ?
  serviceKinds.filter((k) => isString(k)) :
  [LLM_KIND];
  return kindFilter.some((k) => kinds.includes(k));
}

// Combo matches kindFilter when its `kind` field is in the list.
// Combos with no kind are treated as LLM.
