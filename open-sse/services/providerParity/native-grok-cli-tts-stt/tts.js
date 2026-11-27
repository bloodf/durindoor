// Grok CLI native text-to-speech: one JSON POST to https://api.x.ai/v1/tts
// with the Grok Build OAuth token, answered with audio bytes. Staged for
// /v1/audio/speech and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/grokMedia.ts handleGrokSpeech and buildGrokSpeechPayload
// (headers from grokMediaHeaders plus `Content-Type: application/json`; body
// `{ text: input, voice_id: voice_id ?? voice ?? "eve", language: language ??
// "auto", output_format: { ...native output_format, codec }, speed? }`, codec
// from `response_format`, then `output_format.codec`, then "mp3"; codecs mp3,
// wav, pcm, mulaw, alaw; speed a finite number from 0.7 to 1.5), selected by
// the `grok-tts` branch of open-sse/handlers/audioSpeech.ts.
//
// Fork deviations: see ./http.js for transport; in addition only the source
// model `grok-tts`; streaming, a non-object `output_format` (the source
// silently ignores arrays), `output_format` keys other than codec,
// sample_rate and bit_rate, non-string voice or language, and an oversized
// request are refused before submit. The answer is read in full within the
// deadline and must be bounded, non-empty audio, not JSON or HTML; mp3 and wav
// are checked by magic bytes (pcm, mulaw and alaw are headerless).
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult, errorEnvelopeMessage, readBoundedResponseText } from "../../../utils/error.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  GROK_CLI_PROVIDER_ID, GROK_DEFAULT_CODEC, GROK_DEFAULT_LANGUAGE, GROK_DEFAULT_VOICE, GROK_MAX_AUDIO_BYTES,
  GROK_MAX_SPEED, GROK_MAX_TTS_REQUEST_BYTES, GROK_MIN_SPEED, GROK_SPEECH_CODECS, GROK_SPEECH_URL, GROK_TTS_MODELS,
  GROK_TTS_TIMEOUT_MS, grokTtsModel, grokVoiceHeaders,
} from "./config.js";
import { discard, grokOAuthToken, invalid, lostResult, sendOnce, withAcceptedJob } from "./http.js";

const MODALITY = "tts";
const LABEL = "speech";
const MAX_ENVELOPE_BYTES = 16 * 1024;
const MAX_TEXT_FIELD = 128;
const OUTPUT_FORMAT_KEYS = new Set(["codec", "sample_rate", "bit_rate"]);
const AUDIO_MIME = /^(audio\/[a-z0-9.+-]+|application\/octet-stream|binary\/octet-stream)$/;

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });

function optionalText(value, name) {
  if (value === undefined || value === null || value === "") return null;
  if (!isString(value) || !value.trim()) throw reject(`Grok speech ${name} must be a non-empty string`);
  if (value.length > MAX_TEXT_FIELD || /[\r\n]/.test(value)) throw reject(`Grok speech ${name} is not valid`);
  return value;
}

function nativeOutputFormat(value) {
  if (value === undefined || value === null) return {};
  if (!isRecord(value) || Array.isArray(value)) throw reject("Grok speech output_format must be an object");
  for (const [key, entry] of Object.entries(value)) {
    if (!OUTPUT_FORMAT_KEYS.has(key)) throw reject(`Grok speech output_format does not support ${key}`);
    if (key !== "codec" && (!Number.isInteger(entry) || entry <= 0)) throw reject(`Grok speech output_format.${key} must be a positive integer`);
  }
  return value;
}

/**
 * The source's Grok speech body for an OpenAI-style speech request.
 * Throws a 400 error for an unknown model or an input this subset cannot honor.
 *
 * @param {string} model - `grok-tts`
 * @param {string} text - the speech input
 * @param {object} [options] - the rest of the speech request (`response_format` is the codec)
 */
export function buildGrokSpeechRequest(model, text, options = {}) {
  if (!grokTtsModel(model)) throw reject(`Unsupported Grok CLI speech model: ${model}. Use one of: ${GROK_TTS_MODELS.map((m) => m.id).join(", ")}`);
  if (!isString(text) || !text.trim()) throw reject("Grok speech needs input text");
  if (options.stream === true || (options.stream_format !== undefined && options.stream_format !== "audio")) {
    throw reject("Grok speech does not support streaming");
  }
  const nativeFormat = nativeOutputFormat(options.output_format);
  const codec = options.response_format ?? nativeFormat.codec ?? GROK_DEFAULT_CODEC;
  if (!isString(codec) || !GROK_SPEECH_CODECS.includes(codec)) throw reject(`Grok speech supports ${GROK_SPEECH_CODECS.join(", ")}`);
  const speed = options.speed;
  if (speed !== undefined && (!isNumber(speed) || !Number.isFinite(speed) || speed < GROK_MIN_SPEED || speed > GROK_MAX_SPEED)) {
    throw reject(`Grok speech speed must be between ${GROK_MIN_SPEED} and ${GROK_MAX_SPEED}`);
  }
  const voice = optionalText(options.voice_id, "voice_id") ?? optionalText(options.voice, "voice") ?? GROK_DEFAULT_VOICE;
  const language = optionalText(options.language, "language") ?? GROK_DEFAULT_LANGUAGE;
  const request = {
    text,
    voice_id: voice,
    language,
    output_format: { ...nativeFormat, codec },
  };
  if (speed !== undefined) request.speed = speed;
  if (Buffer.byteLength(JSON.stringify(request)) > GROK_MAX_TTS_REQUEST_BYTES) throw reject("Grok speech request is too large");
  return request;
}

/** Whether bytes start like the named container. Headerless codecs only need bytes. */
export function matchesGrokCodec(codec, bytes) {
  if (codec === "mp3") {
    if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
    return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) === 0x02;
  }
  if (codec === "wav") return bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WAVE";
  return bytes.length > 0;
}

/** A 200 JSON answer on the audio route: an error envelope or a lost result. Its text is never quoted. */
async function envelopeOrLost(response, signal) {
  let text = "";
  try {
    text = await readBoundedResponseText(response, { signal, maxBytes: MAX_ENVELOPE_BYTES, timeoutMs: 2_000, throwOnTimeout: true });
  } catch {
    discard(response);
    return lostResult(MODALITY, LABEL, "answered without audio");
  }
  let value = null;
  try {
    value = JSON.parse(text);
  } catch {
    // The parser's message quotes the body, so it is dropped.
  }
  if (isRecord(value) && errorEnvelopeMessage(value)) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Grok speech answered with an error payload instead of audio");
  }
  return lostResult(MODALITY, LABEL, "answered without audio");
}

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.timeoutMs] - deadline for the request and its body
 * @param {number} [options.maxAudioBytes]
 */
export function createGrokCliTtsAdapter({ fetchImpl, timeoutMs = GROK_TTS_TIMEOUT_MS, maxAudioBytes = GROK_MAX_AUDIO_BYTES } = {}) {
  return {
    provider: GROK_CLI_PROVIDER_ID,
    models: GROK_TTS_MODELS,
    codecs: GROK_SPEECH_CODECS,
    /**
     * TTS adapter contract (ttsCore.js): `{ base64, format, accounting }` on
     * success (ttsCore applies the gateway's json/binary wrapper), or a full
     * error result; `local` marks caller input errors and `acceptedJob` marks a
     * request xAI may have processed and billed.
     */
    async synthesize(text, model, credentials, _responseFormat, options = {}) {
      const { signal } = options;
      let payload;
      try {
        payload = buildGrokSpeechRequest(model, text, options);
      } catch (error) {
        return invalid(error.message);
      }
      const auth = grokOAuthToken(credentials);
      if (auth.failure) return auth.failure;
      const codec = payload.output_format.codec;
      const sent = await sendOnce(GROK_SPEECH_URL, {
        method: "POST",
        headers: { ...grokVoiceHeaders(auth.token), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, { modality: MODALITY, label: LABEL, credentials, signal, timeoutMs, fetchImpl });
      if (sent.failure) return sent.failure;
      const { response, fetchSignal } = sent;
      try {
        const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (/json/.test(type)) return await envelopeOrLost(response, fetchSignal);
        if (type && !AUDIO_MIME.test(type)) {
          discard(response);
          return lostResult(MODALITY, LABEL, "answered without audio");
        }
        let bytes;
        try {
          bytes = await readBounded(response.body, maxAudioBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY);
        } catch {
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Grok CLI speech request aborted after it was sent"), MODALITY, "accepted");
          if (sent.timedOut()) return lostResult(MODALITY, LABEL, "audio did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT);
          return lostResult(MODALITY, LABEL, "audio was unreadable or too large");
        }
        if (bytes.length === 0) return lostResult(MODALITY, LABEL, "audio was empty");
        if (!matchesGrokCodec(codec, bytes)) return lostResult(MODALITY, LABEL, `audio is not ${codec}`);
        // xAI reports no usage on this route; cost stays unknown, characters are counted by ttsCore.
        const accounting = mediaAccounting(null, GROK_CLI_PROVIDER_ID, MODALITY);
        accounting.meta = { nativeUnitsSource: "input-characters", model, codec, authMode: "oauth" };
        return { base64: bytes.toString("base64"), format: codec, accounting };
      } finally {
        sent.clear();
      }
    },
  };
}
