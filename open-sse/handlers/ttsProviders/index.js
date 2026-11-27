import { createMediaRegistry, lookupMediaAdapter } from "../mediaRegistry.js";
// TTS provider registry
import googleTts from "./googleTts.js";
import edgeTts, { fetchEdgeTtsVoices } from "./edgeTts.js";
import localDevice, { fetchLocalDeviceVoices } from "./localDevice.js";
import elevenlabs, { fetchElevenLabsVoices, fetchElevenLabsModels } from "./elevenlabs.js";
import openai from "./openai.js";
import openrouter from "./openrouter.js";
import gemini, { fetchGeminiVoices } from "./gemini.js";
import renderhour from "./renderhour.js";
import vertex, { listVertexTtsVoices } from "../../services/providerParity/native-vertex-tts-stt/speech.js";
import { kieTtsAdapter } from "../../services/providerParity/native-kie-tts-stt/index.js";
import { FORMAT_HANDLERS } from "./genericFormats.js";
import { parseModelVoice } from "./_base.js";

// Special providers with custom synthesize() logic
export const TTS_ADAPTERS = createMediaRegistry({
  "google-tts": googleTts,
  "edge-tts": edgeTts,
  "local-device": localDevice,
  elevenlabs,
  openai,
  openrouter,
  gemini,
  // Submit-and-poll speech job; RenderHour picks the voice and container.
  renderhour,
  // Vertex Gemini speech through generateContent on the existing connection.
  vertex,
  vx: vertex,
  // ElevenLabs speech as a Kie createTask job; the audio is fetched without the key.
  kie: kieTtsAdapter,
});

export function getTtsAdapter(provider) {
  return lookupMediaAdapter(TTS_ADAPTERS, provider);
}

// Generic config-driven dispatcher (uses ttsConfig.format)
export async function synthesizeViaConfig(provider, text, model, credentials, proxyOptions = null, options = {}) {
  const { AI_PROVIDERS } = await import("@/shared/constants/providers");
  const cfg = AI_PROVIDERS[provider]?.ttsConfig;
  if (!cfg) return null;
  const handler = FORMAT_HANDLERS[cfg.format];
  if (!handler) return null;
  const apiKey = credentials?.apiKey;
  if (cfg.authType !== "none" && !apiKey) throw new Error(`${provider} API key required`);
  const { PROVIDER_MODELS } = await import("open-sse/config/providerModels.js");
  const ttsModels = cfg.models || (PROVIDER_MODELS[provider] || []).filter(m => (m.kind || m.type) === "tts");
  const defaultModel = ttsModels[0]?.id || "";
  // The old NVIDIA catalog omitted the vendor prefix from this model ID.
  const resolvedModel = provider === "nvidia" && model === "magpie-tts-multilingual" ? `nvidia/${model}` : model;
  const { modelId, voiceId } = parseModelVoice(resolvedModel, defaultModel, cfg.defaultVoice || "", ttsModels);
  const upstreamOptions = provider === "nan" && options.responseFormat && options.responseFormat !== "json" ? { response_format: options.responseFormat } : {};
  return handler({ ...upstreamOptions, ...options, baseUrl: cfg.baseUrl, apiKey, text, modelId, voiceId, proxyOptions });
}

// Voice fetchers (used by /api/media-providers/tts/voices route)
export const VOICE_FETCHERS = {
  "edge-tts": fetchEdgeTtsVoices,
  "local-device": fetchLocalDeviceVoices,
  elevenlabs: fetchElevenLabsVoices,
  gemini: fetchGeminiVoices,
  // Vertex Gemini speech serves the same prebuilt voices.
  vertex: listVertexTtsVoices,
};

// Re-export for backward compat
export { fetchEdgeTtsVoices, fetchLocalDeviceVoices, fetchElevenLabsVoices, fetchElevenLabsModels, fetchGeminiVoices };
