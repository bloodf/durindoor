// Soniox native text-to-speech: one JSON POST to https://tts-rt.soniox.com/tts,
// answered with audio bytes. Staged for /v1/audio/speech and not registered
// (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/audioSpeech.ts handleSonioxSpeech (headers
// `Content-Type: application/json` and `Authorization: Bearer <key>`; body
// `{ text, model, language, voice, audio_format }` in that order; language is
// the trimmed `language` or "en"; voice from resolveSonioxVoice: the trimmed
// voice unless empty or an OpenAI stock voice, else "Adrian"; audio_format is
// response_format or "mp3", with "pcm" sent as "pcm_s16le"; the answer is
// labelled audio/wav for wav, audio/opus for opus, audio/mpeg otherwise) and
// open-sse/config/audioRegistry.ts (`soniox` speech row: tts-rt-v2,
// tts-rt-v1).
//
// Fork deviations: see ./http.js for transport; in addition only the two
// source models; only the three containers the source labels (mp3, wav, opus)
// plus the gateway's json wrapper; pcm (no container to verify), other
// containers, streaming, a speed other than 1, non-empty instructions (the
// source drops both silently), a non-string or malformed voice or language,
// conflicting voices or containers, and an oversized request are refused
// before submit; the answer must be bounded audio whose leading bytes match the
// requested container, not JSON or HTML.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult, errorEnvelopeMessage, readBoundedResponseText } from "../../../utils/error.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  SONIOX_DEFAULT_CONTAINER, SONIOX_DEFAULT_LANGUAGE, SONIOX_DEFAULT_VOICE, SONIOX_MAX_AUDIO_BYTES,
  SONIOX_MAX_TTS_REQUEST_BYTES, SONIOX_OPENAI_STOCK_VOICES, SONIOX_PROVIDER_ID, SONIOX_TTS_MODELS, SONIOX_TTS_TIMEOUT_MS,
  SONIOX_TTS_URL,
} from "./config.js";
import { discard, invalid, lostResult, sendOnce, sonioxToken, withAcceptedJob } from "./http.js";

const MODALITY = "tts";
const LABEL = "speech";
/** Containers this adapter can verify, in the source's wire spelling. */
export const SONIOX_SPEECH_CONTAINERS = Object.freeze(["mp3", "wav", "opus"]);
/** Every response_format value accepted from a client: the containers and the gateway's json wrapper. */
export const SONIOX_SPEECH_RESPONSE_FORMATS = Object.freeze([...SONIOX_SPEECH_CONTAINERS, "json"]);
/** Source content-type labels. */
export const SONIOX_SPEECH_CONTENT_TYPES = Object.freeze({ mp3: "audio/mpeg", wav: "audio/wav", opus: "audio/opus" });
const MAX_ENVELOPE_BYTES = 16 * 1024;
const AUDIO_MIME = /^(audio\/[a-z0-9.+-]+|application\/ogg|application\/octet-stream|binary\/octet-stream)$/;
const VOICE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/;
const STOCK = new Set(SONIOX_OPENAI_STOCK_VOICES);

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const ascii = (bytes, start, text) => bytes.length >= start + text.length && bytes.subarray(start, start + text.length).toString("latin1") === text;

/** Leading-byte signatures for each container. */
const SIGNATURES = Object.freeze({
  mp3: (b) => ascii(b, 0, "ID3") || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) === 0x02),
  wav: (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE"),
  opus: (b) => ascii(b, 0, "OggS"),
});

/** Whether bytes start like the named container. */
export function matchesSonioxContainer(container, bytes) {
  const check = SIGNATURES[container];
  return Boolean(check && check(bytes));
}

/**
 * The container to request, from the client's named response_format and the
 * gateway's query-string format (mp3 when the client named none). `json` names
 * the gateway wrapper, not a container. Throws a 400 error.
 */
export function resolveSonioxContainer(requested, gatewayFormat = null) {
  const named = [];
  for (const value of [requested, gatewayFormat]) {
    if (value === null || value === undefined || value === "") continue;
    if (!isString(value)) throw reject("Soniox speech response_format must be a string");
    const format = value.trim().toLowerCase();
    if (format === "pcm") throw reject("Soniox speech pcm output is not supported here; use mp3, wav or opus");
    if (!SONIOX_SPEECH_RESPONSE_FORMATS.includes(format)) {
      throw reject(`Soniox speech supports response_format ${SONIOX_SPEECH_RESPONSE_FORMATS.join(", ")}`);
    }
    if (format !== "json") named.push(format);
  }
  // The gateway format defaults to mp3 when the query names none, so only a
  // non-mp3 gateway format can conflict with a body format.
  if (named.length === 2 && named[0] !== named[1] && named[1] !== SONIOX_DEFAULT_CONTAINER) {
    throw reject("Soniox speech response_format is named twice with different values");
  }
  return named[0] ?? SONIOX_DEFAULT_CONTAINER;
}

/** `{ modelId, voice }` from `model` or `model/voice`, or a 400 error. */
function resolveModel(model) {
  if (!isString(model) || !model) throw reject("Soniox speech needs a model");
  for (const entry of SONIOX_TTS_MODELS) {
    if (model === entry.id) return { modelId: entry.id, voice: null };
    if (model.startsWith(`${entry.id}/`) && model.length > entry.id.length + 1) return { modelId: entry.id, voice: model.slice(entry.id.length + 1) };
  }
  throw reject(`Unsupported Soniox speech model: ${model}. Use one of: ${SONIOX_TTS_MODELS.map((m) => m.id).join(", ")}`);
}

/** Source resolveSonioxVoice: an OpenAI stock voice or nothing becomes the default voice. */
export function resolveSonioxVoice(voice) {
  const value = isString(voice) ? voice.trim() : "";
  return value && !STOCK.has(value) ? value : SONIOX_DEFAULT_VOICE;
}

/**
 * The source's Soniox speech body for an OpenAI-style speech request.
 * Throws a 400 error for an unknown model or an input this subset cannot honor.
 *
 * @param {string} model - `modelId` or `modelId/voice`
 * @param {string} text - the speech input
 * @param {object} [options] - the rest of the speech request; `container` is the resolved container
 */
export function buildSonioxSpeechRequest(model, text, options = {}) {
  const { modelId, voice: modelVoice } = resolveModel(model);
  if (!isString(text) || !text.trim()) throw reject("Soniox speech needs input text");
  if (options.stream === true || (options.stream_format !== undefined && options.stream_format !== "audio")) {
    throw reject("Soniox speech does not support streaming here");
  }
  if (options.speed !== undefined && options.speed !== null && options.speed !== 1) {
    throw reject("Soniox speech does not support speed; omit it or send 1");
  }
  if (options.instructions !== undefined && options.instructions !== null && options.instructions !== "") {
    throw reject("Soniox speech does not support instructions");
  }
  if (options.voice !== undefined && options.voice !== null && !isString(options.voice)) throw reject("Soniox speech voice must be a string");
  const requestedVoice = isString(options.voice) ? options.voice.trim() : "";
  if (modelVoice && requestedVoice && requestedVoice !== modelVoice) throw reject("Soniox speech voice is named twice with different values");
  const voice = resolveSonioxVoice(requestedVoice || modelVoice);
  if (!VOICE_PATTERN.test(voice)) throw reject("Soniox speech voice is not a valid voice name");
  if (options.language !== undefined && options.language !== null && !isString(options.language)) throw reject("Soniox speech language must be a string");
  const language = isString(options.language) && options.language.trim() ? options.language.trim() : SONIOX_DEFAULT_LANGUAGE;
  if (!LANGUAGE_PATTERN.test(language)) throw reject("Soniox speech language must be a language code such as en");
  const container = options.container ?? SONIOX_DEFAULT_CONTAINER;
  if (!SONIOX_SPEECH_CONTAINERS.includes(container)) throw reject(`Soniox speech container must be one of ${SONIOX_SPEECH_CONTAINERS.join(", ")}`);
  const request = { text, model: modelId, language, voice, audio_format: container };
  if (Buffer.byteLength(JSON.stringify(request)) > SONIOX_MAX_TTS_REQUEST_BYTES) throw reject("Soniox speech request is too large");
  return request;
}

/**
 * A 200 JSON answer on the audio route. An error envelope is a refusal that
 * produced no audio; its text is not quoted. Anything else is a lost result of
 * work Soniox may have billed.
 */
async function envelopeOrLost(response, signal, container) {
  let text = "";
  try {
    text = await readBoundedResponseText(response, { signal, maxBytes: MAX_ENVELOPE_BYTES, timeoutMs: 2_000, throwOnTimeout: true });
  } catch {
    discard(response);
    return lostResult(MODALITY, LABEL, `answered without ${container} audio`);
  }
  let value = null;
  try {
    value = JSON.parse(text);
  } catch {
    // The parser's message quotes the body, so it is dropped.
  }
  if (isRecord(value) && errorEnvelopeMessage(value)) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Soniox speech answered with an error payload instead of audio");
  }
  return lostResult(MODALITY, LABEL, `answered without ${container} audio`);
}

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.timeoutMs] - deadline for the request and its body
 * @param {number} [options.maxAudioBytes]
 */
export function createSonioxTtsAdapter({ fetchImpl, timeoutMs = SONIOX_TTS_TIMEOUT_MS, maxAudioBytes = SONIOX_MAX_AUDIO_BYTES } = {}) {
  return {
    provider: SONIOX_PROVIDER_ID,
    models: SONIOX_TTS_MODELS,
    responseFormats: SONIOX_SPEECH_RESPONSE_FORMATS,
    /**
     * TTS adapter contract (ttsCore.js): `{ base64, format, accounting }` on
     * success, or a full error result; `local` marks caller input errors and
     * `acceptedJob` marks a request Soniox may have processed and billed.
     */
    async synthesize(text, model, credentials, responseFormat, options = {}) {
      const { signal } = options;
      let payload;
      try {
        const requested = options.requestedResponseFormat ?? options.response_format ?? null;
        const container = resolveSonioxContainer(requested, responseFormat ?? null);
        payload = buildSonioxSpeechRequest(model, text, { ...options, container });
      } catch (error) {
        return invalid(error.message);
      }
      const container = payload.audio_format;
      const token = sonioxToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable Soniox API key on this connection");
      const sent = await sendOnce(SONIOX_TTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }, { modality: MODALITY, label: LABEL, credentials, signal, timeoutMs, fetchImpl });
      if (sent.failure) return sent.failure;
      const { response, fetchSignal } = sent;
      try {
        const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (/json/.test(type)) return await envelopeOrLost(response, fetchSignal, container);
        if (type && !AUDIO_MIME.test(type)) {
          discard(response);
          return lostResult(MODALITY, LABEL, `answered without ${container} audio`);
        }
        let bytes;
        try {
          bytes = await readBounded(response.body, maxAudioBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY);
        } catch {
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Soniox speech request aborted after it was sent"), MODALITY, "accepted");
          if (sent.timedOut()) return lostResult(MODALITY, LABEL, "audio did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT);
          return lostResult(MODALITY, LABEL, "audio was unreadable or too large");
        }
        if (bytes.length === 0) return lostResult(MODALITY, LABEL, "audio was empty");
        if (!matchesSonioxContainer(container, bytes)) return lostResult(MODALITY, LABEL, `audio is not ${container}`);
        // Soniox reports no usage on this route; the cost stays unknown.
        const accounting = mediaAccounting(null, SONIOX_PROVIDER_ID, MODALITY);
        accounting.meta = { nativeUnitsSource: "input-characters", model: payload.model, contentType: SONIOX_SPEECH_CONTENT_TYPES[container] };
        return { base64: bytes.toString("base64"), format: container, accounting };
      } finally {
        sent.clear();
      }
    },
  };
}
