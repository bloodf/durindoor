// Qwen Cloud Token Plan (DashScope SpeechSynthesizer) native text-to-speech
// metadata, staged and not registered (#2034).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/config/audioRegistry.ts (the `qwen-cloud-token-plan` speech entry:
// id "qwen-cloud-token-plan", alias "qct", baseUrl
// https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer,
// authType "apikey", authHeader "bearer", format "dashscope-tts",
// supportedFormats ["mp3"], models [qwen-audio-3.0-tts-plus]),
// open-sse/handlers/audioSpeech.ts (the `dashscope-tts` dispatch) and
// open-sse/executors/dashscopeTts.ts (handleDashscopeTtsSpeech,
// DASHSCOPE_TTS_DEFAULT_VOICE, the 50 MiB download cap).
//
// DurinDoor already has the `qwen-cloud-token-plan` chat provider
// (open-sse/providers/registry/qwen-cloud-token-plan.js, alias qct, apikey,
// serviceKinds ["llm"]) with no speech half. This module stages only the
// speech half of that existing credential identity; see ./registration.json.
// The other Alibaba-family identities (alibaba, alibaba-cn, qwen-cloud,
// alitp-intl, alicode*, bailian-coding-plan, qwencloud) keep their own hosts
// and keys and are not touched: the source registry has no speech row for them.

import { dashscopeMediaOrigin } from "../native-dashscope-image/regions.js";

export const DASHSCOPE_TTS_PROVIDER_ID = "qwen-cloud-token-plan";
/** The source registry alias, identical to the existing local registry alias. */
export const DASHSCOPE_TTS_ALIAS = "qct";
export const DASHSCOPE_TTS_AUTH_MODES = Object.freeze(["apikey"]);
export const DASHSCOPE_TTS_FORMAT = "dashscope-tts";
/** The only origin the adapter sends the key to: the source registry host (Singapore). */
export const DASHSCOPE_TTS_ORIGIN = "https://token-plan.ap-southeast-1.maas.aliyuncs.com";
/** Source SPEECH_SYNTHESIZER_PATH under the media root (/api/v1). */
export const DASHSCOPE_TTS_PATH = "/api/v1/services/audio/tts/SpeechSynthesizer";
export const DASHSCOPE_TTS_URL = `${DASHSCOPE_TTS_ORIGIN}${DASHSCOPE_TTS_PATH}`;

/**
 * The SpeechSynthesizer URL of this identity in a canonical source region
 * (source resolveSpeechSynthesizerUrl over resolveAlibabaProviderMediaBaseUrl,
 * as the finite map in ../native-dashscope-image/regions.js), or null.
 */
export function dashscopeTtsUrl(region) {
  const origin = dashscopeMediaOrigin(DASHSCOPE_TTS_PROVIDER_ID, region);
  return origin ? `${origin}${DASHSCOPE_TTS_PATH}` : null;
}
/** Source DASHSCOPE_TTS_DEFAULT_VOICE ("longanlufeng" is the other published one). */
export const DASHSCOPE_TTS_DEFAULT_VOICE = "longanlingxin";
/** Source body constant `parameters.sample_rate`. */
export const DASHSCOPE_TTS_SAMPLE_RATE = 24000;
/** Source `supportedFormats`; also the only `parameters.format` the source sends. */
export const DASHSCOPE_TTS_CONTAINERS = Object.freeze(["mp3"]);

export const DASHSCOPE_TTS_MODELS = Object.freeze([
  Object.freeze({ id: "qwen-audio-3.0-tts-plus", name: "Qwen Audio 3.0 TTS Plus", kind: "tts" }),
]);
export const DASHSCOPE_TTS_DEFAULT_MODEL = DASHSCOPE_TTS_MODELS[0].id;

/**
 * Source resolver region values (src/shared/constants/alibabaProviderRegions.ts
 * normalizeAlibabaProviderRegion) that select the registry's Singapore host.
 * The default (pinned) adapter refuses any other named region before submit.
 * The regional adapter (`regional: true`) also serves the source's
 * china-beijing Token Plan host; see dashscopeTtsUrl.
 */
export const DASHSCOPE_TTS_SINGAPORE_REGIONS = Object.freeze(["global-sg", "global", "international", "singapore", "ap-southeast-1"]);

// Gateway bounds. The source sets none except the 50 MiB download cap.
export const DASHSCOPE_TTS_TIMEOUT_MS = 120_000;
export const DASHSCOPE_TTS_DOWNLOAD_TIMEOUT_MS = 60_000;
export const DASHSCOPE_TTS_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const DASHSCOPE_TTS_MAX_REQUEST_BYTES = 256 * 1024;
export const DASHSCOPE_TTS_MAX_ENVELOPE_BYTES = Math.ceil(DASHSCOPE_TTS_MAX_AUDIO_BYTES / 3) * 4 + 64 * 1024;

export const dashscopeTtsModel = (id) => DASHSCOPE_TTS_MODELS.find((model) => model.id === id) ?? null;

/** Staged speech config for the existing registry entry (same shape as other ttsConfig blocks). */
export const DASHSCOPE_TTS_CONFIG = Object.freeze({
  baseUrl: DASHSCOPE_TTS_URL,
  authType: "apikey",
  authHeader: "bearer",
  format: DASHSCOPE_TTS_FORMAT,
  supportedFormats: DASHSCOPE_TTS_CONTAINERS,
  defaultVoice: DASHSCOPE_TTS_DEFAULT_VOICE,
  models: DASHSCOPE_TTS_MODELS,
});

/**
 * Staged additions to the existing `qwen-cloud-token-plan` registry entry.
 * Identity, display, auth and the chat transport stay as they are; only the
 * speech kind, the speech model row and the speech config are added.
 */
export const DASHSCOPE_TTS_PROVIDER_ADDITIONS = Object.freeze({
  id: DASHSCOPE_TTS_PROVIDER_ID,
  alias: DASHSCOPE_TTS_ALIAS,
  authModes: DASHSCOPE_TTS_AUTH_MODES,
  addServiceKinds: Object.freeze(["tts"]),
  addModels: DASHSCOPE_TTS_MODELS,
  ttsConfig: DASHSCOPE_TTS_CONFIG,
});
