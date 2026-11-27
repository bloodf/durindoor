// deAPI native text-to-speech: one OpenAI-compatible POST to
// https://oai.deapi.ai/v1/audio/speech, answered with mp3 bytes. Staged for
// /v1/audio/speech and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/audioSpeech.ts handleAudioSpeech default branch (headers
// `Content-Type: application/json` and `Authorization: Bearer <key>`; body
// `{ model, input, voice: voice || "alloy", response_format, speed: speed ||
// 1.0, instructions? }`, instructions only when a non-empty string) and
// open-sse/config/audioRegistry.ts (`deapi` speech row: mp3 only, four models,
// the voice-design model needs `instructions`).
//
// Fork deviations: see ./http.js for transport; in addition only the four
// source models; a named container other than mp3 (or the gateway's json
// wrapper), streaming, a non-numeric or out-of-range speed, a non-string voice
// or instructions, the voice-design model without instructions, and an
// oversized request are refused before submit; `response_format` is always
// sent as "mp3" (the only container the source lists); the answer must be
// bounded mp3 bytes, checked by magic bytes, not JSON or HTML.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult, errorEnvelopeMessage, readBoundedResponseText } from "../../../utils/error.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  DEAPI_DEFAULT_SPEED, DEAPI_DEFAULT_VOICE, DEAPI_MAX_AUDIO_BYTES, DEAPI_MAX_TTS_REQUEST_BYTES, DEAPI_PROVIDER_ID,
  DEAPI_SPEECH_CONTAINER, DEAPI_SPEECH_URL, DEAPI_TTS_MODELS, DEAPI_TTS_TIMEOUT_MS, deapiTtsModel,
} from "./config.js";
import { deapiToken, discard, invalid, lostResult, sendOnce, withAcceptedJob } from "./http.js";

const MODALITY = "tts";
const LABEL = "speech";
/** Containers this adapter honors: mp3, or the gateway's json wrapper around it. */
export const DEAPI_SPEECH_RESPONSE_FORMATS = Object.freeze(["mp3", "json"]);
const MIN_SPEED = 0.25;
const MAX_SPEED = 4.0;
const MAX_ENVELOPE_BYTES = 16 * 1024;
const AUDIO_MIME = /^(audio\/(mpeg|mp3|mpeg3|x-mpeg|x-mp3)|application\/octet-stream|binary\/octet-stream)$/;

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });

/** `{ modelId, voice }` from `model` or `model/voice`, or a 400 error. */
function resolveModel(model) {
  if (!isString(model) || !model) throw reject("deAPI speech needs a model");
  for (const entry of DEAPI_TTS_MODELS) {
    if (model === entry.id) return { modelId: entry.id, voice: null };
    if (model.startsWith(`${entry.id}/`) && model.length > entry.id.length + 1) return { modelId: entry.id, voice: model.slice(entry.id.length + 1) };
  }
  throw reject(`Unsupported deAPI speech model: ${model}. Use one of: ${DEAPI_TTS_MODELS.map((m) => m.id).join(", ")}`);
}

/**
 * The source's deAPI speech body for an OpenAI-style speech request.
 * Throws a 400 error for an unknown model or an input this subset cannot honor.
 *
 * @param {string} model - `modelId` or `modelId/voice`
 * @param {string} text - the speech input
 * @param {object} [options] - the rest of the speech request
 */
export function buildDeapiSpeechRequest(model, text, options = {}) {
  const { modelId, voice: modelVoice } = resolveModel(model);
  const entry = deapiTtsModel(modelId);
  if (!isString(text) || !text.trim()) throw reject("deAPI speech needs input text");
  if (options.stream === true || (options.stream_format !== undefined && options.stream_format !== "audio")) {
    throw reject("deAPI speech does not support streaming");
  }
  if (options.voice !== undefined && options.voice !== null && !isString(options.voice)) throw reject("deAPI speech voice must be a string");
  const requestedVoice = isString(options.voice) ? options.voice.trim() : "";
  if (modelVoice && requestedVoice && requestedVoice !== modelVoice) throw reject("deAPI speech voice is named twice with different values");
  const speed = options.speed ?? null;
  if (speed !== null && (!isNumber(speed) || !Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED)) {
    throw reject(`deAPI speech speed must be a number from ${MIN_SPEED} to ${MAX_SPEED}`);
  }
  const instructions = options.instructions ?? null;
  if (instructions !== null && !isString(instructions)) throw reject("deAPI speech instructions must be a string");
  if (entry.requiresInstructions && !(isString(instructions) && instructions.trim())) {
    throw reject(`deAPI model ${modelId} needs instructions describing the voice`);
  }
  const request = {
    model: modelId,
    input: text,
    voice: requestedVoice || modelVoice || DEAPI_DEFAULT_VOICE,
    response_format: DEAPI_SPEECH_CONTAINER,
    speed: speed || DEAPI_DEFAULT_SPEED,
    ...(isString(instructions) && instructions ? { instructions } : null),
  };
  if (Buffer.byteLength(JSON.stringify(request)) > DEAPI_MAX_TTS_REQUEST_BYTES) throw reject("deAPI speech request is too large");
  return request;
}

/** Whether bytes start like an mp3 file (ID3 tag or an MPEG layer III frame). */
export function isMp3(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) === 0x02;
}

/**
 * A 200 JSON answer on the audio route. An error envelope is a refusal that
 * produced no audio (9router #5864 convention); its text is not quoted.
 * Anything else is a lost result of work deAPI may have billed.
 */
async function envelopeOrLost(response, signal) {
  let text = "";
  try {
    text = await readBoundedResponseText(response, { signal, maxBytes: MAX_ENVELOPE_BYTES, timeoutMs: 2_000, throwOnTimeout: true });
  } catch {
    discard(response);
    return lostResult(MODALITY, LABEL, "answered without mp3 audio");
  }
  let value = null;
  try {
    value = JSON.parse(text);
  } catch {
    // The parser's message quotes the body, so it is dropped.
  }
  if (isRecord(value) && errorEnvelopeMessage(value)) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "deAPI speech answered with an error payload instead of audio");
  }
  return lostResult(MODALITY, LABEL, "answered without mp3 audio");
}

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.timeoutMs] - deadline for the request and its body
 * @param {number} [options.maxAudioBytes]
 */
export function createDeapiTtsAdapter({ fetchImpl, timeoutMs = DEAPI_TTS_TIMEOUT_MS, maxAudioBytes = DEAPI_MAX_AUDIO_BYTES } = {}) {
  return {
    provider: DEAPI_PROVIDER_ID,
    models: DEAPI_TTS_MODELS,
    responseFormats: DEAPI_SPEECH_RESPONSE_FORMATS,
    /**
     * TTS adapter contract (ttsCore.js): `{ base64, format, accounting }` on
     * success, or a full error result; `local` marks caller input errors and
     * `acceptedJob` marks a request deAPI may have processed and billed.
     */
    async synthesize(text, model, credentials, _responseFormat, options = {}) {
      const { signal } = options;
      const rawRequested = options.requestedResponseFormat ?? options.response_format ?? null;
      const requested = isString(rawRequested) ? rawRequested.toLowerCase() : rawRequested;
      if (requested !== null && !DEAPI_SPEECH_RESPONSE_FORMATS.includes(requested)) {
        return invalid("deAPI speech returns mp3 only; omit response_format, or use mp3 or json");
      }
      let payload;
      try {
        payload = buildDeapiSpeechRequest(model, text, options);
      } catch (error) {
        return invalid(error.message);
      }
      const token = deapiToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable deAPI API key on this connection");
      const sent = await sendOnce(DEAPI_SPEECH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }, { modality: MODALITY, label: LABEL, credentials, signal, timeoutMs, fetchImpl });
      if (sent.failure) return sent.failure;
      const { response, fetchSignal } = sent;
      try {
        const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (/json/.test(type)) return await envelopeOrLost(response, fetchSignal);
        if (type && !AUDIO_MIME.test(type)) {
          discard(response);
          return lostResult(MODALITY, LABEL, "answered without mp3 audio");
        }
        let bytes;
        try {
          bytes = await readBounded(response.body, maxAudioBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY);
        } catch {
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "deAPI speech request aborted after it was sent"), MODALITY, "accepted");
          if (sent.timedOut()) return lostResult(MODALITY, LABEL, "audio did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT);
          return lostResult(MODALITY, LABEL, "audio was unreadable or too large");
        }
        if (bytes.length === 0) return lostResult(MODALITY, LABEL, "audio was empty");
        if (!isMp3(bytes)) return lostResult(MODALITY, LABEL, "audio is not an mp3 file");
        // deAPI reports no usage on this route; the cost stays unknown.
        const accounting = mediaAccounting(null, DEAPI_PROVIDER_ID, MODALITY);
        accounting.meta = { nativeUnitsSource: "input-characters", model: payload.model };
        return { base64: bytes.toString("base64"), format: DEAPI_SPEECH_CONTAINER, accounting };
      } finally {
        sent.clear();
      }
    },
  };
}
