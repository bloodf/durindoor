// Hyperbolic native text-to-speech: one JSON POST to
// https://api.hyperbolic.xyz/v1/audio/generation, answered with
// `{ audio: "<base64 mp3>" }`. Staged for /v1/audio/speech and not registered
// (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/audioSpeech.ts handleHyperbolicSpeech (headers
// `Content-Type: application/json` and `Authorization: Bearer <key>`; body
// exactly `{ text: input }`; the model id is not sent; `data.audio` decoded
// with atob and served as audio/mpeg) and open-sse/config/audioRegistry.ts
// (`hyperbolic` speech row, one model `melo-tts`).
//
// Fork deviations: see ./http.js for transport. In addition, because the source
// sends only `text`, every request field it would silently drop is refused
// before submit instead: a voice (field or `model/voice` suffix), a speed other
// than 1, instructions, a language, streaming, a model other than melo-tts, a
// named container other than mp3 (or the gateway's json wrapper), and an
// oversized request. The answer must be a bounded JSON object whose `audio`
// is strict base64 of mp3 bytes (checked by magic bytes).
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult, errorEnvelopeMessage } from "../../../utils/error.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  HYPERBOLIC_DEFAULT_TTS_MODEL, HYPERBOLIC_MAX_AUDIO_BYTES, HYPERBOLIC_MAX_TTS_REQUEST_BYTES, HYPERBOLIC_PROVIDER_ID,
  HYPERBOLIC_SPEECH_CONTAINER, HYPERBOLIC_TTS_MODELS, HYPERBOLIC_TTS_TIMEOUT_MS, HYPERBOLIC_TTS_URL, hyperbolicTtsModel,
} from "./config.js";
import { discard, hyperbolicToken, invalid, lostResult, sendOnce, withAcceptedJob } from "./http.js";

const MODALITY = "tts";
const LABEL = "speech";
/** Containers this adapter honors: mp3, or the gateway's json wrapper around it. */
export const HYPERBOLIC_SPEECH_RESPONSE_FORMATS = Object.freeze(["mp3", "json"]);
const ENVELOPE_SLACK_BYTES = 16 * 1024;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const named = (value) => value !== undefined && value !== null && !(isString(value) && !value.trim());

/**
 * The source's Hyperbolic speech body for an OpenAI-style speech request.
 * Throws a 400 error for an unknown model or any field the source would drop.
 *
 * @param {string} [model] - `melo-tts`; empty selects it
 * @param {string} text - the speech input
 * @param {object} [options] - the rest of the speech request
 * @returns {{ text: string }}
 */
export function buildHyperbolicSpeechRequest(model, text, options = {}) {
  const modelId = isString(model) && model ? model : HYPERBOLIC_DEFAULT_TTS_MODEL;
  if (!hyperbolicTtsModel(modelId)) {
    if (isString(model) && model.startsWith(`${HYPERBOLIC_DEFAULT_TTS_MODEL}/`)) throw reject("Hyperbolic speech has no voice selection");
    throw reject(`Unsupported Hyperbolic speech model: ${modelId}. Use one of: ${HYPERBOLIC_TTS_MODELS.map((m) => m.id).join(", ")}`);
  }
  if (!isString(text) || !text.trim()) throw reject("Hyperbolic speech needs input text");
  if (options.stream === true || (options.stream_format !== undefined && options.stream_format !== "audio")) {
    throw reject("Hyperbolic speech does not support streaming");
  }
  if (named(options.voice)) throw reject("Hyperbolic speech has no voice selection");
  const speed = options.speed ?? null;
  if (speed !== null && !(isNumber(speed) && speed === 1)) throw reject("Hyperbolic speech does not support speed");
  if (named(options.instructions)) throw reject("Hyperbolic speech does not support instructions");
  if (named(options.language)) throw reject("Hyperbolic speech does not support a language hint");
  const request = { text };
  if (Buffer.byteLength(JSON.stringify(request)) > HYPERBOLIC_MAX_TTS_REQUEST_BYTES) throw reject("Hyperbolic speech request is too large");
  return request;
}

/** Whether bytes start like an mp3 file (ID3 tag or an MPEG layer III frame). */
export function isMp3(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) === 0x02;
}

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.timeoutMs] - deadline for the request and its body
 * @param {number} [options.maxAudioBytes] - decoded audio cap
 */
export function createHyperbolicTtsAdapter({ fetchImpl, timeoutMs = HYPERBOLIC_TTS_TIMEOUT_MS, maxAudioBytes = HYPERBOLIC_MAX_AUDIO_BYTES } = {}) {
  const maxEnvelopeBytes = Math.ceil(maxAudioBytes / 3) * 4 + ENVELOPE_SLACK_BYTES;
  return {
    provider: HYPERBOLIC_PROVIDER_ID,
    models: HYPERBOLIC_TTS_MODELS,
    responseFormats: HYPERBOLIC_SPEECH_RESPONSE_FORMATS,
    /**
     * TTS adapter contract (ttsCore.js): `{ base64, format, accounting }` on
     * success, or a full error result; `local` marks caller input errors and
     * `acceptedJob` marks a request Hyperbolic may have processed and billed.
     */
    async synthesize(text, model, credentials, _responseFormat, options = {}) {
      const { signal } = options;
      const rawRequested = options.requestedResponseFormat ?? options.response_format ?? null;
      const requested = isString(rawRequested) ? rawRequested.toLowerCase() : rawRequested;
      if (requested !== null && !HYPERBOLIC_SPEECH_RESPONSE_FORMATS.includes(requested)) {
        return invalid("Hyperbolic speech returns mp3 only; omit response_format, or use mp3 or json");
      }
      let payload;
      try {
        payload = buildHyperbolicSpeechRequest(model, text, options);
      } catch (error) {
        return invalid(error.message);
      }
      const token = hyperbolicToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable Hyperbolic API key on this connection");

      const sent = await sendOnce(HYPERBOLIC_TTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }, { modality: MODALITY, label: LABEL, credentials, signal, timeoutMs, fetchImpl });
      if (sent.failure) return sent.failure;

      const { response, fetchSignal } = sent;
      try {
        const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (type && !/json/.test(type)) {
          discard(response);
          return lostResult(MODALITY, LABEL, "answered without a JSON audio payload");
        }
        let raw;
        try {
          raw = await readBounded(response.body, maxEnvelopeBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY);
        } catch {
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Hyperbolic speech request aborted after it was sent"), MODALITY, "accepted");
          if (sent.timedOut()) return lostResult(MODALITY, LABEL, "audio did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT);
          return lostResult(MODALITY, LABEL, "audio was unreadable or too large");
        }
        let data = null;
        try {
          data = JSON.parse(raw.toString("utf8"));
        } catch {
          // The parser's message quotes the body, so it is dropped.
        }
        if (!isRecord(data)) return lostResult(MODALITY, LABEL, "answered without a JSON audio payload");
        if (!isString(data.audio) && errorEnvelopeMessage(data)) {
          // A refusal that produced no audio (9router #5864 convention); its text is not quoted.
          return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Hyperbolic speech answered with an error payload instead of audio");
        }
        if (!isString(data.audio) || !data.audio || !BASE64.test(data.audio)) {
          return lostResult(MODALITY, LABEL, "audio was missing or not base64");
        }
        const bytes = Buffer.from(data.audio, "base64");
        if (bytes.length === 0) return lostResult(MODALITY, LABEL, "audio was empty");
        if (bytes.length > maxAudioBytes) return lostResult(MODALITY, LABEL, "audio was unreadable or too large");
        if (!isMp3(bytes)) return lostResult(MODALITY, LABEL, "audio is not an mp3 file");
        // The source documents no usage or price on this route, so the cost stays unknown;
        // any extra fields Hyperbolic adds are not read as a receipt.
        const accounting = mediaAccounting(null, HYPERBOLIC_PROVIDER_ID, MODALITY);
        accounting.meta = { nativeUnitsSource: "input-characters", model: HYPERBOLIC_DEFAULT_TTS_MODEL };
        return { base64: bytes.toString("base64"), format: HYPERBOLIC_SPEECH_CONTAINER, accounting };
      } finally {
        sent.clear();
      }
    },
  };
}
