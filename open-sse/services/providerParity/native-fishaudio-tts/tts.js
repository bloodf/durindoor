// Fish Audio native text-to-speech: one JSON POST to https://api.fish.audio/v1/tts
// with the model id in a `model` header, answered with raw audio bytes. Staged
// for /v1/audio/speech and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/executors/fishAudioTts.ts buildFishAudioSpeechPayload and
// handleFishAudioSpeech (headers `Content-Type: application/json`,
// `Authorization: Bearer <key>`, `model: <model id>`; body `{ text, format,
// reference_id?, ...provider_options.fishaudio, prosody? }`; `ogg` maps to
// `opus`; `speed` becomes `prosody.speed`; inline `references` are refused
// because Fish needs MessagePack for them) and open-sse/config/audioRegistry.ts
// (`fishaudio` speech row).
//
// Fork deviations: see ./http.js for transport. In addition, every field the
// source would silently drop is refused before submit: an unknown model, an
// unknown `provider_options.fishaudio` key, a bitrate for another container,
// instructions, a language hint, streaming, conflicting voices, and an
// oversized request. Reference ids must match the source's safe voice-id
// pattern. The answer is read to a bounded size and must look like the
// container that was asked for (magic bytes), never a JSON error payload.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult } from "../../../utils/error.js";
import { isBoolean, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  FISH_AUDIO_DEFAULT_TTS_MODEL, FISH_AUDIO_FORMATS, FISH_AUDIO_LATENCY, FISH_AUDIO_MAX_AUDIO_BYTES,
  FISH_AUDIO_MAX_REFERENCE_ID_LENGTH, FISH_AUDIO_MAX_REFERENCE_IDS, FISH_AUDIO_MAX_TTS_REQUEST_BYTES,
  FISH_AUDIO_MP3_BITRATES, FISH_AUDIO_OPTIONS_KEY, FISH_AUDIO_OPUS_BITRATES, FISH_AUDIO_PROVIDER_ID,
  FISH_AUDIO_SAMPLE_RATES, FISH_AUDIO_TTS_MODELS, FISH_AUDIO_TTS_TIMEOUT_MS, FISH_AUDIO_TTS_URL, fishAudioTtsModel,
} from "./config.js";
import { discard, fishAudioToken, invalid, lostResult, sendOnce, withAcceptedJob } from "./http.js";

const MODALITY = "tts";
const LABEL = "speech";
/** The gateway's JSON wrapper (query `response_format=json`) around any container. */
const GATEWAY_JSON = "json";
/** Source voice-id pattern (fishAudioProxy.ts isSafeFishAudioVoiceId). */
export const FISH_AUDIO_SAFE_ID = /^[A-Za-z0-9_-]+$/;
export const isSafeFishAudioId = (value) =>
  isString(value) && value.length <= FISH_AUDIO_MAX_REFERENCE_ID_LENGTH && FISH_AUDIO_SAFE_ID.test(value);

/** Keys the source reads from `provider_options.fishaudio`. */
export const FISH_AUDIO_OPTION_KEYS = Object.freeze([
  "reference_id", "temperature", "top_p", "chunk_length", "normalize", "sample_rate", "mp3_bitrate",
  "opus_bitrate", "latency", "max_new_tokens", "repetition_penalty", "min_chunk_length",
  "condition_on_previous_chunks", "early_stop_threshold", "features", "prosody", "references",
]);
const PROSODY_KEYS = new Set(["speed", "volume", "normalize_loudness"]);

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const named = (value) => value !== undefined && value !== null && !(isString(value) && !value.trim());

function numberOption(value, name, { min, max, integer } = {}) {
  if (value === undefined) return undefined;
  if (!isNumber(value) || !Number.isFinite(value)) throw reject(`${name} must be a finite number`);
  if (integer && !Number.isInteger(value)) throw reject(`${name} must be an integer`);
  if (min !== undefined && value < min) throw reject(`${name} must be >= ${min}`);
  if (max !== undefined && value > max) throw reject(`${name} must be <= ${max}`);
  return value;
}

function booleanOption(value, name) {
  if (value === undefined) return undefined;
  if (!isBoolean(value)) throw reject(`${name} must be a boolean`);
  return value;
}

function enumOption(value, name, allowed) {
  if (value === undefined) return undefined;
  if (!allowed.includes(value)) throw reject(`${name} must be one of: ${allowed.join(", ")}`);
  return value;
}

/** Source `normalizeResponseFormat`: lower-case, `ogg` is `opus`. */
const normalizeContainer = (value) => {
  const lower = value.toLowerCase();
  return lower === "ogg" ? "opus" : lower;
};

/**
 * The container to ask Fish for. The body's `response_format` (source field)
 * wins; a query `response_format` other than the gateway's json wrapper is the
 * same request and must agree with it. `requestedResponseFormat` is the
 * client's exact query value (NAMED_FORMAT_PROVIDERS); the positional query
 * format defaults to mp3 when absent, so mp3 there names nothing.
 */
export function resolveFishAudioContainer(options = {}, queryFormat = null) {
  const fromBody = named(options.response_format) ? options.response_format : null;
  const positional = isString(queryFormat) && !["mp3", GATEWAY_JSON].includes(queryFormat.toLowerCase()) ? queryFormat : null;
  const rawQuery = options.requestedResponseFormat ?? positional;
  const fromQuery = named(rawQuery) && isString(rawQuery) && rawQuery.toLowerCase() !== GATEWAY_JSON ? rawQuery : null;
  if (fromBody !== null && !isString(fromBody)) throw reject("response_format must be a string");
  const body = fromBody === null ? null : normalizeContainer(fromBody);
  const query = fromQuery === null ? null : normalizeContainer(fromQuery);
  if (body && query && body !== query) throw reject("response_format in the body and the query disagree");
  const container = body ?? query ?? "mp3";
  if (!FISH_AUDIO_FORMATS.includes(container)) throw reject(`response_format must be one of: ${FISH_AUDIO_FORMATS.join(", ")} (ogg is opus)`);
  return container;
}

/** The model id and an optional `model/voice` suffix voice. */
export function resolveFishAudioModel(model) {
  if (!isString(model) || !model) return { modelId: FISH_AUDIO_DEFAULT_TTS_MODEL, suffixVoice: null };
  if (fishAudioTtsModel(model)) return { modelId: model, suffixVoice: null };
  const known = FISH_AUDIO_TTS_MODELS.find((row) => model.startsWith(`${row.id}/`));
  if (known) return { modelId: known.id, suffixVoice: model.slice(known.id.length + 1) };
  throw reject(`Unsupported Fish Audio speech model: ${model}. Use one of: ${FISH_AUDIO_TTS_MODELS.map((row) => row.id).join(", ")}`);
}

function referenceIds(value) {
  if (isString(value)) {
    const id = value.trim();
    if (!isSafeFishAudioId(id)) throw reject("reference_id must be a Fish voice model id (letters, digits, _ or -)");
    return id;
  }
  if (Array.isArray(value) && value.length > 0 && value.length <= FISH_AUDIO_MAX_REFERENCE_IDS
    && value.every((item) => isString(item) && isSafeFishAudioId(item.trim()))) {
    return value.map((item) => item.trim());
  }
  throw reject(`reference_id must be a Fish voice model id or an array of 1-${FISH_AUDIO_MAX_REFERENCE_IDS} ids`);
}

function fishOptions(options) {
  const providerOptions = options.provider_options;
  if (providerOptions === undefined || providerOptions === null) return {};
  if (!isRecord(providerOptions)) throw reject("provider_options must be an object");
  const fish = providerOptions[FISH_AUDIO_OPTIONS_KEY];
  if (fish === undefined || fish === null) return {};
  if (!isRecord(fish)) throw reject(`provider_options.${FISH_AUDIO_OPTIONS_KEY} must be an object`);
  const unknown = Object.keys(fish).filter((key) => !FISH_AUDIO_OPTION_KEYS.includes(key));
  if (unknown.length) throw reject(`Unsupported Fish Audio option: ${unknown.join(", ")}`);
  return fish;
}

function applyGenerationOptions(payload, fish, container) {
  const values = [
    ["temperature", numberOption(fish.temperature, "temperature", { min: 0, max: 1 })],
    ["top_p", numberOption(fish.top_p, "top_p", { min: 0, max: 1 })],
    ["chunk_length", numberOption(fish.chunk_length, "chunk_length", { min: 100, max: 300, integer: true })],
    ["normalize", booleanOption(fish.normalize, "normalize")],
    ["sample_rate", enumOption(fish.sample_rate, "sample_rate", FISH_AUDIO_SAMPLE_RATES)],
    ["mp3_bitrate", enumOption(fish.mp3_bitrate, "mp3_bitrate", FISH_AUDIO_MP3_BITRATES)],
    ["opus_bitrate", enumOption(fish.opus_bitrate, "opus_bitrate", FISH_AUDIO_OPUS_BITRATES)],
    ["latency", enumOption(fish.latency, "latency", FISH_AUDIO_LATENCY)],
    ["max_new_tokens", numberOption(fish.max_new_tokens, "max_new_tokens", { min: 1, integer: true })],
    ["repetition_penalty", numberOption(fish.repetition_penalty, "repetition_penalty", { min: 0 })],
    ["min_chunk_length", numberOption(fish.min_chunk_length, "min_chunk_length", { min: 0, max: 100, integer: true })],
    ["condition_on_previous_chunks", booleanOption(fish.condition_on_previous_chunks, "condition_on_previous_chunks")],
    ["early_stop_threshold", numberOption(fish.early_stop_threshold, "early_stop_threshold", { min: 0, max: 1 })],
  ];
  for (const [key, value] of values) {
    if (value !== undefined) payload[key] = value;
  }
  // A bitrate for another container would be ignored upstream; refuse it instead.
  if (payload.mp3_bitrate !== undefined && container !== "mp3") throw reject("mp3_bitrate needs response_format mp3");
  if (payload.opus_bitrate !== undefined && container !== "opus") throw reject("opus_bitrate needs response_format opus");
  if (fish.features !== undefined) {
    if (!Array.isArray(fish.features) || fish.features.some((feature) => !isString(feature) || !feature.trim())) {
      throw reject("features must be an array of non-empty strings");
    }
    payload.features = fish.features.map((feature) => feature.trim());
  }
}

function applyProsody(payload, options, fish) {
  const raw = fish.prosody;
  if (raw !== undefined && raw !== null && !isRecord(raw)) throw reject("prosody must be an object");
  const prosody = isRecord(raw) ? raw : {};
  const unknown = Object.keys(prosody).filter((key) => !PROSODY_KEYS.has(key));
  if (unknown.length) throw reject(`Unsupported Fish Audio prosody option: ${unknown.join(", ")}`);
  const speed = numberOption(options.speed ?? prosody.speed, "prosody.speed", { min: 0.5, max: 2 });
  const volume = numberOption(prosody.volume, "prosody.volume", { min: -20, max: 20 });
  const normalizeLoudness = booleanOption(prosody.normalize_loudness, "prosody.normalize_loudness");
  if (speed !== undefined || volume !== undefined || normalizeLoudness !== undefined) {
    const out = {};
    if (speed !== undefined) out.speed = speed;
    if (volume !== undefined) out.volume = volume;
    if (normalizeLoudness !== undefined) out.normalize_loudness = normalizeLoudness;
    payload.prosody = out;
  }
}

/**
 * The source's Fish Audio speech request for an OpenAI-style speech request.
 * Throws a 400 error for anything the source would refuse or silently drop.
 *
 * @param {string} [model] - a Fish model id, optionally `model/<reference_id>`; empty selects s2.1-pro-free
 * @param {string} text - the speech input
 * @param {object} [options] - the rest of the speech request (voice, speed, response_format, provider_options)
 * @param {string|null} [queryFormat] - the gateway's query response_format
 * @returns {{ modelId: string, container: string, payload: object }}
 */
export function buildFishAudioSpeechRequest(model, text, options = {}, queryFormat = null) {
  const { modelId, suffixVoice } = resolveFishAudioModel(model);
  if (!isString(text) || !text.trim()) throw reject("Fish Audio speech needs input text");
  if (options.stream === true || (options.stream_format !== undefined && options.stream_format !== "audio")) {
    throw reject("Fish Audio speech through this route does not support streaming");
  }
  if (named(options.instructions)) throw reject("Fish Audio speech does not support instructions");
  if (named(options.language)) throw reject("Fish Audio speech does not support a language hint");
  const fish = fishOptions(options);
  if (fish.references !== undefined) {
    throw reject("inline references require Fish Audio MessagePack; create a persistent voice model and pass its id as voice/reference_id");
  }
  const container = resolveFishAudioContainer(options, queryFormat);
  const payload = { text, format: container };

  const explicitVoice = named(options.voice) ? options.voice : null;
  if (explicitVoice !== null && suffixVoice !== null && explicitVoice !== suffixVoice) {
    throw reject("voice and the model's /voice suffix name different Fish voices");
  }
  const reference = fish.reference_id ?? explicitVoice ?? suffixVoice ?? undefined;
  if (reference !== undefined) payload.reference_id = referenceIds(reference);

  applyGenerationOptions(payload, fish, container);
  applyProsody(payload, options, fish);
  if (Buffer.byteLength(JSON.stringify(payload)) > FISH_AUDIO_MAX_TTS_REQUEST_BYTES) throw reject("Fish Audio speech request is too large");
  return { modelId, container, payload };
}

/** Whether bytes start like an mp3 file (ID3 tag or an MPEG layer III frame). */
export function isMp3(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) === 0x02;
}

const ascii = (bytes, start, text) => bytes.length >= start + text.length && bytes.subarray(start, start + text.length).toString("latin1") === text;

/** Whether bytes look like the named Fish container. PCM is headerless 16-bit samples. */
export function matchesContainer(bytes, container) {
  if (container === "mp3") return isMp3(bytes);
  if (container === "wav") return ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WAVE");
  if (container === "opus") return ascii(bytes, 0, "OggS");
  if (container === "pcm") return bytes.length % 2 === 0;
  return false;
}

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.timeoutMs] - deadline for the request and its body
 * @param {number} [options.maxAudioBytes] - audio cap
 */
export function createFishAudioTtsAdapter({ fetchImpl, timeoutMs = FISH_AUDIO_TTS_TIMEOUT_MS, maxAudioBytes = FISH_AUDIO_MAX_AUDIO_BYTES } = {}) {
  return {
    provider: FISH_AUDIO_PROVIDER_ID,
    models: FISH_AUDIO_TTS_MODELS,
    responseFormats: Object.freeze([...FISH_AUDIO_FORMATS, "ogg", GATEWAY_JSON]),
    /**
     * TTS adapter contract (ttsCore.js): `{ base64, format, accounting }` on
     * success, or a full error result; `local` marks caller input errors and
     * `acceptedJob` marks a request Fish may have processed and billed.
     */
    async synthesize(text, model, credentials, responseFormat, options = {}) {
      const { signal } = options;
      let request;
      try {
        request = buildFishAudioSpeechRequest(model, text, options, responseFormat);
      } catch (error) {
        return invalid(error.message);
      }
      const token = fishAudioToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable Fish Audio API key on this connection");

      const sent = await sendOnce(FISH_AUDIO_TTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, model: request.modelId },
        body: JSON.stringify(request.payload),
      }, { modality: MODALITY, label: LABEL, credentials, signal, timeoutMs, fetchImpl });
      if (sent.failure) return sent.failure;

      const { response, fetchSignal } = sent;
      try {
        const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (/json|text\/|html/.test(type)) {
          // A 200 with a document instead of audio; its text is not quoted.
          discard(response);
          return lostResult(MODALITY, LABEL, "answered without audio");
        }
        let bytes;
        try {
          bytes = await readBounded(response.body, maxAudioBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY);
        } catch {
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Fish Audio speech request aborted after it was sent"), MODALITY, "accepted");
          if (sent.timedOut()) return lostResult(MODALITY, LABEL, "audio did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT);
          return lostResult(MODALITY, LABEL, "audio was unreadable or too large");
        }
        if (bytes.length === 0) return lostResult(MODALITY, LABEL, "audio was empty");
        if (!matchesContainer(bytes, request.container)) return lostResult(MODALITY, LABEL, `audio is not ${request.container}`);
        // The source documents no usage or price on this route, so the cost stays unknown.
        const accounting = mediaAccounting(null, FISH_AUDIO_PROVIDER_ID, MODALITY);
        accounting.meta = { nativeUnitsSource: "input-characters", model: request.modelId, container: request.container };
        return { base64: bytes.toString("base64"), format: request.container, accounting };
      } finally {
        sent.clear();
      }
    },
  };
}
