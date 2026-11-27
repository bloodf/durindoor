// NanoGPT native text-to-speech: one OpenAI-compatible POST to
// https://nano-gpt.com/api/v1/audio/speech, answered with audio bytes. Staged
// for /v1/audio/speech and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/audioSpeech.ts handleAudioSpeech default branch (headers
// `Content-Type: application/json` and `Authorization: Bearer <key>`; body
// `{ model, input, voice: voice || "alloy", response_format, speed: speed ||
// 1.0, instructions? }`, instructions only when a non-empty string;
// response_format from normalizeSpeechResponseFormat: missing -> "mp3",
// lower-cased, "ogg" -> "opus") and open-sse/config/audioRegistry.ts (`nanogpt`
// speech row: tts-1-hd, tts-1).
//
// Fork deviations: see ./http.js for transport; in addition only the two
// source models; a container other than mp3, opus (ogg), aac, flac or wav (or
// the gateway's json wrapper), pcm (no signature to check), conflicting named
// containers, streaming, a non-numeric or out-of-range speed, a non-string
// voice or instructions, and an oversized request are refused before submit;
// the answer must be bounded audio whose leading bytes match the requested
// container, not JSON or HTML.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult, errorEnvelopeMessage, readBoundedResponseText } from "../../../utils/error.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  NANOGPT_DEFAULT_CONTAINER, NANOGPT_DEFAULT_SPEED, NANOGPT_DEFAULT_VOICE, NANOGPT_MAX_AUDIO_BYTES,
  NANOGPT_MAX_TTS_REQUEST_BYTES, NANOGPT_PROVIDER_ID, NANOGPT_SPEECH_URL, NANOGPT_TTS_MODELS, NANOGPT_TTS_TIMEOUT_MS,
} from "./config.js";
import { discard, invalid, lostResult, nanogptToken, sendOnce, withAcceptedJob } from "./http.js";

const MODALITY = "tts";
const LABEL = "speech";
/** Containers this adapter can verify, in the source's wire spelling. */
export const NANOGPT_SPEECH_CONTAINERS = Object.freeze(["mp3", "opus", "aac", "flac", "wav"]);
/** Every response_format value accepted from a client: the containers, the `ogg` alias and the gateway's json wrapper. */
export const NANOGPT_SPEECH_RESPONSE_FORMATS = Object.freeze([...NANOGPT_SPEECH_CONTAINERS, "ogg", "json"]);
const MIN_SPEED = 0.25;
const MAX_SPEED = 4.0;
const MAX_ENVELOPE_BYTES = 16 * 1024;
const AUDIO_MIME = /^(audio\/[a-z0-9.+-]+|application\/ogg|application\/octet-stream|binary\/octet-stream)$/;

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const ascii = (bytes, start, text) => bytes.length >= start + text.length && bytes.subarray(start, start + text.length).toString("latin1") === text;

/** Leading-byte signatures for each container. */
const SIGNATURES = Object.freeze({
  mp3: (b) => ascii(b, 0, "ID3") || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) === 0x02),
  opus: (b) => ascii(b, 0, "OggS"),
  aac: (b) => ascii(b, 0, "ADIF") || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0),
  flac: (b) => ascii(b, 0, "fLaC"),
  wav: (b) => ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE"),
});

/** Whether bytes start like the named container. */
export function matchesContainer(container, bytes) {
  const check = SIGNATURES[container];
  return Boolean(check && check(bytes));
}

/** Source normalizeSpeechResponseFormat, without its default: lower-case, `ogg` -> `opus`. */
const normalize = (value) => {
  const lower = value.trim().toLowerCase();
  return lower === "ogg" ? "opus" : lower;
};

/**
 * The container to request, from the client's named response_format and the
 * gateway's query-string format (mp3 when the client named none). `json`
 * names the gateway wrapper, not a container. Throws a 400 error.
 */
export function resolveNanogptContainer(requested, gatewayFormat = null) {
  const named = [];
  for (const value of [requested, gatewayFormat]) {
    if (value === null || value === undefined || value === "") continue;
    if (!isString(value)) throw reject("NanoGPT speech response_format must be a string");
    const format = normalize(value);
    if (format === "pcm") throw reject("NanoGPT speech pcm output is not supported here; use mp3, opus, aac, flac or wav");
    if (!NANOGPT_SPEECH_RESPONSE_FORMATS.includes(format)) {
      throw reject(`NanoGPT speech supports response_format ${NANOGPT_SPEECH_RESPONSE_FORMATS.join(", ")}`);
    }
    if (format !== "json") named.push(format);
  }
  // The gateway format defaults to mp3 when the query names none, so only a
  // non-mp3 gateway format can conflict with a body format.
  if (named.length === 2 && named[0] !== named[1] && named[1] !== NANOGPT_DEFAULT_CONTAINER) {
    throw reject("NanoGPT speech response_format is named twice with different values");
  }
  return named[0] ?? NANOGPT_DEFAULT_CONTAINER;
}

/** `{ modelId, voice }` from `model` or `model/voice`, or a 400 error. */
function resolveModel(model) {
  if (!isString(model) || !model) throw reject("NanoGPT speech needs a model");
  for (const entry of NANOGPT_TTS_MODELS) {
    if (model === entry.id) return { modelId: entry.id, voice: null };
    if (model.startsWith(`${entry.id}/`) && model.length > entry.id.length + 1) return { modelId: entry.id, voice: model.slice(entry.id.length + 1) };
  }
  throw reject(`Unsupported NanoGPT speech model: ${model}. Use one of: ${NANOGPT_TTS_MODELS.map((m) => m.id).join(", ")}`);
}

/**
 * The source's NanoGPT speech body for an OpenAI-style speech request.
 * Throws a 400 error for an unknown model or an input this subset cannot honor.
 *
 * @param {string} model - `modelId` or `modelId/voice`
 * @param {string} text - the speech input
 * @param {object} [options] - the rest of the speech request; `container` is the resolved container
 */
export function buildNanogptSpeechRequest(model, text, options = {}) {
  const { modelId, voice: modelVoice } = resolveModel(model);
  if (!isString(text) || !text.trim()) throw reject("NanoGPT speech needs input text");
  if (options.stream === true || (options.stream_format !== undefined && options.stream_format !== "audio")) {
    throw reject("NanoGPT speech does not support streaming");
  }
  if (options.voice !== undefined && options.voice !== null && !isString(options.voice)) throw reject("NanoGPT speech voice must be a string");
  const requestedVoice = isString(options.voice) ? options.voice.trim() : "";
  if (modelVoice && requestedVoice && requestedVoice !== modelVoice) throw reject("NanoGPT speech voice is named twice with different values");
  const speed = options.speed ?? null;
  if (speed !== null && (!isNumber(speed) || !Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED)) {
    throw reject(`NanoGPT speech speed must be a number from ${MIN_SPEED} to ${MAX_SPEED}`);
  }
  const instructions = options.instructions ?? null;
  if (instructions !== null && !isString(instructions)) throw reject("NanoGPT speech instructions must be a string");
  const container = options.container ?? NANOGPT_DEFAULT_CONTAINER;
  if (!NANOGPT_SPEECH_CONTAINERS.includes(container)) throw reject(`NanoGPT speech container must be one of ${NANOGPT_SPEECH_CONTAINERS.join(", ")}`);
  const request = {
    model: modelId,
    input: text,
    voice: requestedVoice || modelVoice || NANOGPT_DEFAULT_VOICE,
    response_format: container,
    speed: speed || NANOGPT_DEFAULT_SPEED,
    ...(isString(instructions) && instructions ? { instructions } : null),
  };
  if (Buffer.byteLength(JSON.stringify(request)) > NANOGPT_MAX_TTS_REQUEST_BYTES) throw reject("NanoGPT speech request is too large");
  return request;
}

/**
 * A 200 JSON answer on the audio route. An error envelope is a refusal that
 * produced no audio (9router #5864 convention); its text is not quoted.
 * Anything else is a lost result of work NanoGPT may have billed.
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
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "NanoGPT speech answered with an error payload instead of audio");
  }
  return lostResult(MODALITY, LABEL, `answered without ${container} audio`);
}

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.timeoutMs] - deadline for the request and its body
 * @param {number} [options.maxAudioBytes]
 */
export function createNanogptTtsAdapter({ fetchImpl, timeoutMs = NANOGPT_TTS_TIMEOUT_MS, maxAudioBytes = NANOGPT_MAX_AUDIO_BYTES } = {}) {
  return {
    provider: NANOGPT_PROVIDER_ID,
    models: NANOGPT_TTS_MODELS,
    responseFormats: NANOGPT_SPEECH_RESPONSE_FORMATS,
    /**
     * TTS adapter contract (ttsCore.js): `{ base64, format, accounting }` on
     * success, or a full error result; `local` marks caller input errors and
     * `acceptedJob` marks a request NanoGPT may have processed and billed.
     */
    async synthesize(text, model, credentials, responseFormat, options = {}) {
      const { signal } = options;
      let payload;
      try {
        const requested = options.requestedResponseFormat ?? options.response_format ?? null;
        const container = resolveNanogptContainer(requested, responseFormat ?? null);
        payload = buildNanogptSpeechRequest(model, text, { ...options, container });
      } catch (error) {
        return invalid(error.message);
      }
      const container = payload.response_format;
      const token = nanogptToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable NanoGPT API key on this connection");
      const sent = await sendOnce(NANOGPT_SPEECH_URL, {
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
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "NanoGPT speech request aborted after it was sent"), MODALITY, "accepted");
          if (sent.timedOut()) return lostResult(MODALITY, LABEL, "audio did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT);
          return lostResult(MODALITY, LABEL, "audio was unreadable or too large");
        }
        if (bytes.length === 0) return lostResult(MODALITY, LABEL, "audio was empty");
        if (!matchesContainer(container, bytes)) return lostResult(MODALITY, LABEL, `audio is not ${container}`);
        // NanoGPT reports no usage on this route; the cost stays unknown.
        const accounting = mediaAccounting(null, NANOGPT_PROVIDER_ID, MODALITY);
        accounting.meta = { nativeUnitsSource: "input-characters", model: payload.model };
        return { base64: bytes.toString("base64"), format: container, accounting };
      } finally {
        sent.clear();
      }
    },
  };
}
