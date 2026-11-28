// Deepgram native text-to-speech: one POST to
// https://api.deepgram.com/v1/speak?model=<model>, answered with MP3 bytes.
// Staged for /v1/audio/speech and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/audioSpeech.ts handleDeepgramSpeech (URL from baseUrl with
// `model` set as a query parameter; headers `Content-Type: application/json`
// and buildAuthHeaders "token" -> `Authorization: Token <key>`; body
// `{ text: input }`; audio answer streamed with audio/mpeg as the default
// content type) and open-sse/config/audioRegistry.ts (`deepgram` speech rows).
//
// Fork deviations: see ./http.js for transport. In addition the model must be
// a Deepgram Aura id; only mp3 (or the gateway's json wrapper of it) is
// offered because the source never asks for another encoding; speed,
// instructions, streaming, a conflicting Aura voice or language, a non-string
// voice and text over Deepgram's 2000-character limit are refused before
// submit; the answer is buffered within a bound and must start like MP3.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult, errorEnvelopeMessage, readBoundedResponseText } from "../../../utils/error.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  DEEPGRAM_CONTAINER, DEEPGRAM_MAX_AUDIO_BYTES, DEEPGRAM_MAX_TEXT_CHARS, DEEPGRAM_PROVIDER_ID, DEEPGRAM_SPEAK_URL,
  DEEPGRAM_SPEECH_RESPONSE_FORMATS, DEEPGRAM_TTS_MODELS, DEEPGRAM_TTS_TIMEOUT_MS, isDeepgramTtsModel,
} from "./config.js";
import { deepgramToken, discard, invalid, lostResult, sendOnce, withAcceptedJob } from "./http.js";

const MODALITY = "tts";
const LABEL = "speech";
const MAX_ENVELOPE_BYTES = 16 * 1024;
const AUDIO_MIME = /^(audio\/(mpeg|mp3|mpeg3|x-mpeg)|application\/octet-stream|binary\/octet-stream)$/;

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const present = (value) => value !== undefined && value !== null && value !== "";
const codePoints = (text) => {
  let count = 0;
  for (const _ of text) count++;
  return count;
};

/** Whether bytes start like MP3 (ID3 tag or an MPEG audio layer III frame sync). */
export function isMp3(bytes) {
  if (bytes.length >= 3 && bytes.subarray(0, 3).toString("latin1") === "ID3") return true;
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) === 0x02;
}

/** The single container this subset produces. Throws a 400 error for any other named format. */
export function resolveDeepgramContainer(...named) {
  for (const value of named) {
    if (!present(value)) continue;
    if (!isString(value)) throw reject("Deepgram speech response_format must be a string");
    const format = value.trim().toLowerCase();
    if (!DEEPGRAM_SPEECH_RESPONSE_FORMATS.includes(format)) {
      throw reject(`Deepgram speech supports response_format ${DEEPGRAM_SPEECH_RESPONSE_FORMATS.join(", ")} here`);
    }
  }
  return DEEPGRAM_CONTAINER;
}

/**
 * The source's Deepgram speech request: `{ url, body }`. Throws a 400 error for
 * an unknown model or an input this subset cannot honor.
 *
 * @param {string} model - an Aura model id, e.g. aura-asteria-en or aura-2-thalia-en
 * @param {string} text - the speech input
 * @param {object} [options] - the rest of the speech request
 */
export function buildDeepgramSpeechRequest(model, text, options = {}) {
  if (!isString(model) || !model) throw reject("Deepgram speech needs a model");
  if (!isDeepgramTtsModel(model)) {
    throw reject(`Unsupported Deepgram speech model: ${model}. Use an Aura model such as ${DEEPGRAM_TTS_MODELS.map((m) => m.id).join(", ")}`);
  }
  if (!isString(text) || !text.trim()) throw reject("Deepgram speech needs input text");
  if (codePoints(text) > DEEPGRAM_MAX_TEXT_CHARS) throw reject(`Deepgram speech input is limited to ${DEEPGRAM_MAX_TEXT_CHARS} characters`);
  if (options.stream === true || (options.stream_format !== undefined && options.stream_format !== "audio")) {
    throw reject("Deepgram speech does not support streaming here");
  }
  // The model is the voice. An OpenAI voice name is ignored as in the source;
  // a different Aura voice would be silently dropped, so it is refused.
  if (present(options.voice) && !isString(options.voice)) throw reject("Deepgram speech voice must be a string");
  const voice = isString(options.voice) ? options.voice.trim() : "";
  if (isDeepgramTtsModel(voice) && voice !== model) throw reject("Deepgram speech voice is the model; they name different voices");
  if (present(options.speed) && !(isNumber(options.speed) && options.speed === 1)) {
    throw reject("Deepgram speech speed is not supported here");
  }
  if (present(options.instructions)) throw reject("Deepgram speech does not support instructions");
  if (present(options.language)) {
    if (!isString(options.language)) throw reject("Deepgram speech language must be a string");
    const primary = options.language.trim().toLowerCase().split(/[-_]/)[0];
    if (primary !== model.slice(-2)) throw reject(`Deepgram speech model ${model} does not speak ${options.language}`);
  }
  const url = new URL(DEEPGRAM_SPEAK_URL);
  url.searchParams.set("model", model);
  return { url: url.toString(), body: { text } };
}

/**
 * A 200 JSON answer on the audio route. An error envelope (Deepgram uses
 * err_code / err_msg) produced no audio; its text is not quoted. Anything
 * else is a lost result of work Deepgram may have billed.
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
  if (isRecord(value) && (errorEnvelopeMessage(value) || isString(value.err_code) || isString(value.err_msg))) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Deepgram speech answered with an error payload instead of audio");
  }
  return lostResult(MODALITY, LABEL, "answered without mp3 audio");
}

/** Deepgram's billed character count header, when it is a plain non-negative integer. */
function reportedCharacters(response) {
  const raw = response.headers.get("dg-char-count");
  return isString(raw) && /^\d{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : null;
}

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.timeoutMs] - deadline for the request and its body
 * @param {number} [options.maxAudioBytes]
 */
export function createDeepgramTtsAdapter({ fetchImpl, timeoutMs = DEEPGRAM_TTS_TIMEOUT_MS, maxAudioBytes = DEEPGRAM_MAX_AUDIO_BYTES } = {}) {
  return {
    provider: DEEPGRAM_PROVIDER_ID,
    models: DEEPGRAM_TTS_MODELS,
    responseFormats: DEEPGRAM_SPEECH_RESPONSE_FORMATS,
    /**
     * TTS adapter contract (ttsCore.js): `{ base64, format, accounting }` on
     * success, or a full error result; `local` marks caller input errors and
     * `acceptedJob` marks a request Deepgram may have processed and billed.
     */
    async synthesize(text, model, credentials, responseFormat, options = {}) {
      const { signal } = options;
      let request;
      try {
        resolveDeepgramContainer(options.requestedResponseFormat, options.response_format, responseFormat);
        request = buildDeepgramSpeechRequest(model, text, options);
      } catch (error) {
        return invalid(error.message);
      }
      const token = deepgramToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable Deepgram API key on this connection");
      const sent = await sendOnce(request.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${token}` },
        body: JSON.stringify(request.body),
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
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Deepgram speech request aborted after it was sent"), MODALITY, "accepted");
          if (sent.timedOut()) return lostResult(MODALITY, LABEL, "audio did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT);
          return lostResult(MODALITY, LABEL, "audio was unreadable or too large");
        }
        if (bytes.length === 0) return lostResult(MODALITY, LABEL, "audio was empty");
        if (!isMp3(bytes)) return lostResult(MODALITY, LABEL, "audio is not mp3");
        // Deepgram reports no price; the cost stays unknown. Its dg-char-count
        // header, when present, is the provider's own character count.
        const accounting = mediaAccounting(null, DEEPGRAM_PROVIDER_ID, MODALITY);
        const characters = reportedCharacters(response);
        if (characters !== null) accounting.nativeUnits = { characters };
        const requestId = response.headers.get("dg-request-id");
        accounting.meta = {
          nativeUnitsSource: characters !== null ? "dg-char-count" : "input-characters",
          model: new URL(request.url).searchParams.get("model"),
          ...(isString(requestId) && /^[A-Za-z0-9-]{1,64}$/.test(requestId) ? { requestId } : null),
        };
        return { base64: bytes.toString("base64"), format: DEEPGRAM_CONTAINER, accounting };
      } finally {
        sent.clear();
      }
    },
  };
}
