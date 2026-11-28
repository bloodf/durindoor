// HuggingFace native text-to-speech: one JSON POST to
// https://router.huggingface.co/hf-inference/models/<owner>/<name>, answered
// with the audio bytes. Staged for /v1/audio/speech and not registered (see
// ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/audioSpeech.ts handleHuggingFaceTtsSpeech (path
// `${baseUrl}/${modelId}` refused when the id contains `..` or `//`; headers
// `Content-Type: application/json` and `Authorization: Bearer <key>`; body
// exactly `{ inputs: input }`; the answer streamed through with its own
// content type, audio/wav when none) and open-sse/config/audioRegistry.ts
// (`huggingface` speech row).
//
// Fork deviations: see ./http.js for transport. In addition:
// - the model id must be exactly one Hub id `owner/name` (stricter than the
//   source's `..`/`//` check); a third path segment would be a voice suffix;
// - every request field the source silently drops is refused before submit: a
//   voice, a speed other than 1, instructions, a language, streaming, a named
//   container (the model picks it), and an oversized request;
// - the answer is read bounded and its container is taken from the bytes
//   (wav, flac, mp3 or ogg); anything else, or a JSON answer, is not served as
//   audio.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult, errorEnvelopeMessage } from "../../../utils/error.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  HUGGINGFACE_DEFAULT_TTS_MODEL, HUGGINGFACE_MAX_AUDIO_BYTES, HUGGINGFACE_MAX_TTS_REQUEST_BYTES, HUGGINGFACE_PROVIDER_ID,
  HUGGINGFACE_TTS_MODELS, HUGGINGFACE_TTS_TIMEOUT_MS, huggingfaceTtsUrl, isHuggingFaceHubId,
} from "./config.js";
import { discard, huggingfaceToken, invalid, lostResult, sendOnce, withAcceptedJob } from "./http.js";

const MODALITY = "tts";
const LABEL = "speech";
/** The model picks the container, so a request may only omit it or ask for the gateway's json wrapper. */
export const HUGGINGFACE_SPEECH_RESPONSE_FORMATS = Object.freeze(["json"]);
/** Containers recognised in an answer, by magic bytes. */
export const HUGGINGFACE_SPEECH_CONTAINERS = Object.freeze(["wav", "flac", "mp3", "ogg"]);
const MAX_ENVELOPE_BYTES = 16 * 1024;

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const named = (value) => value !== undefined && value !== null && !(isString(value) && !value.trim());

/**
 * The source's HuggingFace speech request for an OpenAI-style speech request.
 * Throws a 400 error for a malformed model id or any field the source would drop.
 *
 * @param {string} [model] - a Hub id `owner/name`; empty selects the first source model
 * @param {string} text - the speech input
 * @param {object} [options] - the rest of the speech request
 * @returns {{ url: string, model: string, body: { inputs: string } }}
 */
export function buildHuggingFaceSpeechRequest(model, text, options = {}) {
  const modelId = isString(model) && model ? model : HUGGINGFACE_DEFAULT_TTS_MODEL;
  if (!isHuggingFaceHubId(modelId)) {
    if (isString(modelId) && modelId.split("/").length === 3 && isHuggingFaceHubId(modelId.split("/").slice(0, 2).join("/"))) {
      throw reject("HuggingFace speech has no voice selection");
    }
    throw reject(`Invalid HuggingFace speech model: use a Hub id such as ${HUGGINGFACE_TTS_MODELS.map((m) => m.id).join(", ")}`);
  }
  if (!isString(text) || !text.trim()) throw reject("HuggingFace speech needs input text");
  if (options.stream === true || (options.stream_format !== undefined && options.stream_format !== "audio")) {
    throw reject("HuggingFace speech does not support streaming");
  }
  if (named(options.voice)) throw reject("HuggingFace speech has no voice selection");
  const speed = options.speed ?? null;
  if (speed !== null && !(isNumber(speed) && speed === 1)) throw reject("HuggingFace speech does not support speed");
  if (named(options.instructions)) throw reject("HuggingFace speech does not support instructions");
  if (named(options.language)) throw reject("HuggingFace speech does not support a language hint");
  const body = { inputs: text };
  if (Buffer.byteLength(JSON.stringify(body)) > HUGGINGFACE_MAX_TTS_REQUEST_BYTES) throw reject("HuggingFace speech request is too large");
  return { url: huggingfaceTtsUrl(modelId), model: modelId, body };
}

/** The audio container named by an answer's first bytes, or null. */
export function sniffAudioContainer(bytes) {
  if (!bytes || bytes.length < 4) return null;
  const ascii = (start, end) => Buffer.from(bytes.subarray(start, end)).toString("latin1");
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "wav";
  if (ascii(0, 4) === "fLaC") return "flac";
  if (ascii(0, 4) === "OggS") return "ogg";
  if (ascii(0, 3) === "ID3") return "mp3";
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) === 0x02) return "mp3";
  return null;
}

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.timeoutMs] - deadline for the request and its body
 * @param {number} [options.maxAudioBytes] - audio cap
 */
export function createHuggingFaceTtsAdapter({ fetchImpl, timeoutMs = HUGGINGFACE_TTS_TIMEOUT_MS, maxAudioBytes = HUGGINGFACE_MAX_AUDIO_BYTES } = {}) {
  return {
    provider: HUGGINGFACE_PROVIDER_ID,
    models: HUGGINGFACE_TTS_MODELS,
    responseFormats: HUGGINGFACE_SPEECH_RESPONSE_FORMATS,
    /**
     * TTS adapter contract (ttsCore.js): `{ base64, format, accounting }` on
     * success, or a full error result; `local` marks caller input errors and
     * `acceptedJob` marks a request HuggingFace may have processed and billed.
     */
    async synthesize(text, model, credentials, _responseFormat, options = {}) {
      const { signal } = options;
      const rawRequested = options.requestedResponseFormat ?? options.response_format ?? null;
      const requested = isString(rawRequested) ? rawRequested.toLowerCase() : rawRequested;
      if (requested !== null && !HUGGINGFACE_SPEECH_RESPONSE_FORMATS.includes(requested)) {
        return invalid("HuggingFace speech returns the container the model produces; omit response_format, or use json");
      }
      let request;
      try {
        request = buildHuggingFaceSpeechRequest(model, text, options);
      } catch (error) {
        return invalid(error.message);
      }
      const token = huggingfaceToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable HuggingFace API token on this connection");

      const sent = await sendOnce(request.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(request.body),
      }, { modality: MODALITY, label: LABEL, credentials, signal, timeoutMs, fetchImpl });
      if (sent.failure) return sent.failure;

      const { response, fetchSignal } = sent;
      try {
        const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        const isJson = /json/.test(type);
        if (type && !isJson && !type.startsWith("audio/") && type !== "application/octet-stream") {
          discard(response);
          return lostResult(MODALITY, LABEL, "answered without audio");
        }
        let bytes;
        try {
          bytes = await readBounded(response.body, isJson ? MAX_ENVELOPE_BYTES : maxAudioBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY);
        } catch {
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "HuggingFace speech request aborted after it was sent"), MODALITY, "accepted");
          if (sent.timedOut()) return lostResult(MODALITY, LABEL, "audio did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT);
          return lostResult(MODALITY, LABEL, "audio was unreadable or too large");
        }
        if (isJson) {
          let data = null;
          try {
            data = JSON.parse(bytes.toString("utf8"));
          } catch {
            // The parser's message quotes the body, so it is dropped.
          }
          if (isRecord(data) && errorEnvelopeMessage(data)) {
            // A refusal that produced no audio (9router #5864 convention); its text is not quoted.
            return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "HuggingFace speech answered with an error payload instead of audio");
          }
          return lostResult(MODALITY, LABEL, "answered with JSON instead of audio");
        }
        if (bytes.length === 0) return lostResult(MODALITY, LABEL, "audio was empty");
        const container = sniffAudioContainer(bytes);
        if (!container) return lostResult(MODALITY, LABEL, "audio is not a recognised wav, flac, mp3 or ogg file");
        // The router bills by compute time and returns no usage on this route, so the
        // cost stays unknown; no response header is read as a receipt.
        const accounting = mediaAccounting(null, HUGGINGFACE_PROVIDER_ID, MODALITY);
        accounting.meta = { nativeUnitsSource: "input-characters", model: request.model };
        return { base64: bytes.toString("base64"), format: container, accounting };
      } finally {
        sent.clear();
      }
    },
  };
}
