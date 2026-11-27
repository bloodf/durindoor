// Xiaomi MiMo native text-to-speech: one JSON POST to
// https://api.xiaomimimo.com/v1/chat/completions with an `audio` config,
// answered with base64 audio inside a chat-completions envelope (or, rarely,
// a raw audio body). Staged for /v1/audio/speech and not registered (see
// ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/audioSpeech.ts handleXiaomiMimoSpeech (headers
// `Content-Type: application/json` and `Authorization: Bearer <key>`; body
// exactly `{ model, messages: [{ role: "assistant", content: input }],
// audio: { format, voice } }`; `format` is the enum mp3 | wav from
// normalizeXiaomiMimoRequestFormat, missing → mp3, anything else refused with
// 400 before the upstream call; `voice` is the request voice, else the
// connection's providerSpecificData.defaultVoice, else "mimo_default"; an
// `audio/*` answer is passed through, a JSON answer is read with
// getXiaomiMimoAudioData's path order) and open-sse/config/audioRegistry.ts
// (`xiaomi-mimo` speech row) plus the live /v1/models catalog contract from
// tests/unit/xiaomi-mimo-models-fetch-15307.test.ts.
//
// Fork deviations: see ./http.js for transport. The connection's
// providerSpecificData.baseUrl override the source honors is ignored (fixed
// origin). Every request field the source would silently drop is refused
// before submit instead: a speed other than 1, instructions, a language,
// streaming, a `model/voice` suffix and an oversized request. The answer must
// be bounded, and its audio must be strict base64 (or raw bytes) whose magic
// bytes match the requested container.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult, errorEnvelopeMessage } from "../../../utils/error.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  XIAOMI_MIMO_DEFAULT_TTS_MODEL, XIAOMI_MIMO_DEFAULT_VOICE, XIAOMI_MIMO_DISCOVERY_TIMEOUT_MS, XIAOMI_MIMO_MAX_AUDIO_BYTES,
  XIAOMI_MIMO_MAX_CATALOG_BYTES, XIAOMI_MIMO_MAX_TTS_REQUEST_BYTES, XIAOMI_MIMO_MODELS_URL, XIAOMI_MIMO_PROVIDER_ID,
  XIAOMI_MIMO_TTS_MODEL_PATTERN, XIAOMI_MIMO_TTS_MODELS, XIAOMI_MIMO_TTS_TIMEOUT_MS, XIAOMI_MIMO_TTS_URL, xiaomiMimoTtsModel,
} from "./config.js";
import { boundedSend, discard, invalid, lostResult, redirected, sendOnce, withAcceptedJob, xiaomiMimoToken } from "./http.js";

const MODALITY = "tts";
const LABEL = "speech";
/** Named formats this adapter honors: the source mp3/wav aliases, or the gateway's json wrapper (mp3). */
export const XIAOMI_MIMO_SPEECH_RESPONSE_FORMATS = Object.freeze([
  "mp3", "mpeg", "audio/mp3", "audio/mpeg", "wav", "wave", "audio/wav", "audio/wave", "json",
]);
const ENVELOPE_SLACK_BYTES = 64 * 1024;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });
const named = (value) => value !== undefined && value !== null && !(isString(value) && !value.trim());

/**
 * Source normalizeXiaomiMimoRequestFormat, plus the gateway json wrapper
 * (served as mp3). Returns "mp3", "wav", or null for anything unsupported.
 */
export function normalizeXiaomiMimoRequestFormat(format) {
  if (format === undefined || format === null) return "mp3";
  if (!isString(format)) return null;
  switch (format.trim().toLowerCase()) {
    case "mp3": case "mpeg": case "audio/mp3": case "audio/mpeg": case "json":
      return "mp3";
    case "wav": case "wave": case "audio/wav": case "audio/wave":
      return "wav";
    default:
      return null;
  }
}

/** Whether a model id is a MiMo speech model (a static row, or a newer catalog `-tts` id). */
export const isXiaomiMimoTtsModelId = (id) => isString(id) && (Boolean(xiaomiMimoTtsModel(id)) || XIAOMI_MIMO_TTS_MODEL_PATTERN.test(id));

/**
 * The source's Xiaomi MiMo speech body for an OpenAI-style speech request.
 * Throws a 400 error for an unknown model or any field the source would drop.
 *
 * @param {string} [model] - a MiMo speech model; empty selects mimo-v2.5-tts
 * @param {string} text - the speech input
 * @param {object} [options] - the rest of the speech request (voice, speed, ...)
 * @param {object} [context] - { format: "mp3" | "wav", defaultVoice }
 */
export function buildXiaomiMimoSpeechRequest(model, text, options = {}, { format = "mp3", defaultVoice } = {}) {
  const modelId = isString(model) && model ? model : XIAOMI_MIMO_DEFAULT_TTS_MODEL;
  if (!isXiaomiMimoTtsModelId(modelId)) {
    if (modelId.includes("/")) throw reject("Xiaomi MiMo speech takes the voice in the voice field, not a model/voice suffix");
    throw reject(`Unsupported Xiaomi MiMo speech model: ${modelId}. Use one of: ${XIAOMI_MIMO_TTS_MODELS.map((m) => m.id).join(", ")}`);
  }
  if (!isString(text) || !text.trim()) throw reject("Xiaomi MiMo speech needs input text");
  if (options.stream === true || (options.stream_format !== undefined && options.stream_format !== "audio")) {
    throw reject("Xiaomi MiMo speech does not support streaming");
  }
  if (format !== "mp3" && format !== "wav") throw reject("Xiaomi MiMo TTS supports response_format mp3 or wav only");
  const speed = options.speed ?? null;
  if (speed !== null && !(isNumber(speed) && speed === 1)) throw reject("Xiaomi MiMo speech does not support speed");
  if (named(options.instructions)) throw reject("Xiaomi MiMo speech does not support instructions");
  if (named(options.language)) throw reject("Xiaomi MiMo speech does not support a language hint");
  let voice;
  if (named(options.voice)) {
    if (!isString(options.voice)) throw reject("Xiaomi MiMo speech voice must be a string");
    voice = options.voice;
  } else {
    voice = isString(defaultVoice) && defaultVoice.trim() ? defaultVoice.trim() : XIAOMI_MIMO_DEFAULT_VOICE;
  }
  const request = {
    model: modelId,
    messages: [{ role: "assistant", content: text }],
    audio: { format, voice },
  };
  if (Buffer.byteLength(JSON.stringify(request)) > XIAOMI_MIMO_MAX_TTS_REQUEST_BYTES) throw reject("Xiaomi MiMo speech request is too large");
  return request;
}

/** Source getXiaomiMimoAudioData path order; only non-empty strings count. */
export function xiaomiMimoAudioData(data) {
  const str = (v) => (isString(v) && v.trim() ? v.trim() : null);
  const messageAudio = data?.choices?.[0]?.message?.audio;
  const directAudio = data?.audio || data?.output_audio;
  const firstDataItem = Array.isArray(data?.data) ? data.data[0] : null;
  return (
    str(messageAudio?.data) || str(messageAudio?.b64_json) || str(directAudio?.data) || str(directAudio?.b64_json) ||
    str(firstDataItem?.b64_json) || str(firstDataItem?.audio) || str(data?.audioContent) || str(data?.audio_content)
  );
}

/** Whether bytes start like an mp3 file (ID3 tag or an MPEG layer III frame). */
export function isMp3(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) === 0x02;
}

/** Whether bytes start like a RIFF/WAVE file. */
export const isWav = (bytes) => bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WAVE";

const matchesContainer = (bytes, format) => (format === "wav" ? isWav(bytes) : isMp3(bytes));

/**
 * Token counts the chat envelope may carry. Only numeric `*_tokens` fields are
 * kept: the speech route documents no price, so a cost-looking field is never
 * read as a receipt and the cost stays unknown.
 */
function speechAccounting(data, model, format) {
  const usage = isRecord(data?.usage)
    ? Object.fromEntries(Object.entries(data.usage).filter(([key, value]) => /_tokens$/.test(key) && isNumber(value) && Number.isFinite(value) && value >= 0))
    : {};
  const accounting = mediaAccounting(Object.keys(usage).length ? { usage } : null, XIAOMI_MIMO_PROVIDER_ID, MODALITY);
  accounting.meta = { ...accounting.meta, nativeUnitsSource: "input-characters", model, container: format };
  return accounting;
}

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.timeoutMs] - deadline for the request and its body
 * @param {number} [options.maxAudioBytes] - decoded audio cap
 */
export function createXiaomiMimoTtsAdapter({ fetchImpl, timeoutMs = XIAOMI_MIMO_TTS_TIMEOUT_MS, maxAudioBytes = XIAOMI_MIMO_MAX_AUDIO_BYTES } = {}) {
  const maxEnvelopeBytes = Math.ceil(maxAudioBytes / 3) * 4 + ENVELOPE_SLACK_BYTES;
  return {
    provider: XIAOMI_MIMO_PROVIDER_ID,
    models: XIAOMI_MIMO_TTS_MODELS,
    responseFormats: XIAOMI_MIMO_SPEECH_RESPONSE_FORMATS,
    /**
     * TTS adapter contract (ttsCore.js): `{ base64, format, accounting }` on
     * success, or a full error result; `local` marks caller input errors and
     * `acceptedJob` marks a request Xiaomi may have processed and billed.
     */
    async synthesize(text, model, credentials, _responseFormat, options = {}) {
      const { signal } = options;
      const requested = options.requestedResponseFormat ?? options.response_format ?? null;
      const format = normalizeXiaomiMimoRequestFormat(requested);
      if (!format) return invalid("Xiaomi MiMo TTS supports response_format mp3 or wav only");
      const providerData = isRecord(credentials?.providerSpecificData) ? credentials.providerSpecificData : {};
      let payload;
      try {
        payload = buildXiaomiMimoSpeechRequest(model, text, options, { format, defaultVoice: providerData.defaultVoice });
      } catch (error) {
        return invalid(error.message);
      }
      const token = xiaomiMimoToken(credentials);
      if (!token) {
        return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "Xiaomi MiMo speech needs an API key connection; account sessions are not accepted by the speech API");
      }

      const sent = await sendOnce(XIAOMI_MIMO_TTS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      }, { modality: MODALITY, label: LABEL, credentials, signal, timeoutMs, fetchImpl });
      if (sent.failure) return sent.failure;

      const { response, fetchSignal } = sent;
      try {
        const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        const rawAudio = type.startsWith("audio/");
        if (!rawAudio && type && !/json/.test(type)) {
          discard(response);
          return lostResult(MODALITY, LABEL, "answered without an audio payload");
        }
        let raw;
        try {
          raw = await readBounded(response.body, rawAudio ? maxAudioBytes : maxEnvelopeBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY);
        } catch {
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Xiaomi MiMo speech request aborted after it was sent"), MODALITY, "accepted");
          if (sent.timedOut()) return lostResult(MODALITY, LABEL, "audio did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT);
          return lostResult(MODALITY, LABEL, "audio was unreadable or too large");
        }
        let bytes;
        let data = null;
        if (rawAudio) {
          bytes = raw;
        } else {
          try {
            data = JSON.parse(raw.toString("utf8"));
          } catch {
            // The parser's message quotes the body, so it is dropped.
          }
          if (!isRecord(data)) return lostResult(MODALITY, LABEL, "answered without a JSON audio payload");
          const audio = xiaomiMimoAudioData(data);
          if (!audio && errorEnvelopeMessage(data)) {
            // A refusal that produced no audio (9router #5864 convention); its text is not quoted.
            return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Xiaomi MiMo speech answered with an error payload instead of audio");
          }
          if (!audio || !BASE64.test(audio)) return lostResult(MODALITY, LABEL, "audio was missing or not base64");
          bytes = Buffer.from(audio, "base64");
        }
        if (bytes.length === 0) return lostResult(MODALITY, LABEL, "audio was empty");
        if (bytes.length > maxAudioBytes) return lostResult(MODALITY, LABEL, "audio was unreadable or too large");
        if (!matchesContainer(bytes, format)) return lostResult(MODALITY, LABEL, `audio is not a ${format} file`);
        return { base64: bytes.toString("base64"), format, accounting: speechAccounting(data, payload.model, format) };
      } finally {
        sent.clear();
      }
    },
  };
}

/**
 * Live speech-model discovery (source #15307: GET <origin>/v1/models with the
 * connection key, falling back to the local catalog on any failure). Only ids
 * that name a MiMo speech model are returned; chat/ASR rows are dropped.
 * Never throws and never returns upstream text.
 *
 * @returns {Promise<{ models: object[], source: "api" | "local_catalog", status?: number }>}
 */
export async function discoverXiaomiMimoTtsModels(credentials, { fetchImpl, signal, timeoutMs = XIAOMI_MIMO_DISCOVERY_TIMEOUT_MS } = {}) {
  const fallback = (status) => ({ models: [...XIAOMI_MIMO_TTS_MODELS], source: "local_catalog", ...(status ? { status } : null) });
  const token = xiaomiMimoToken(credentials);
  if (!token) return fallback(HTTP_STATUS.UNAUTHORIZED);
  let sent;
  try {
    sent = await boundedSend(XIAOMI_MIMO_MODELS_URL, { method: "GET", headers: { Authorization: `Bearer ${token}` } }, { fetchImpl, credentials, signal, timeoutMs });
  } catch {
    return fallback(HTTP_STATUS.BAD_GATEWAY);
  }
  const { response, fetchSignal } = sent;
  try {
    if (redirected(response)) return fallback(HTTP_STATUS.BAD_GATEWAY);
    if (!response.ok) {
      discard(response);
      return fallback(response.status);
    }
    let body;
    try {
      body = JSON.parse((await readBounded(response.body, XIAOMI_MIMO_MAX_CATALOG_BYTES, fetchSignal, HTTP_STATUS.BAD_GATEWAY)).toString("utf8"));
    } catch {
      return fallback(HTTP_STATUS.BAD_GATEWAY);
    }
    if (!isRecord(body) || !Array.isArray(body.data)) return fallback(HTTP_STATUS.BAD_GATEWAY);
    const seen = new Set();
    const models = [];
    for (const row of body.data) {
      const id = isString(row?.id) ? row.id.trim() : "";
      if (!isXiaomiMimoTtsModelId(id) || seen.has(id)) continue;
      seen.add(id);
      models.push(xiaomiMimoTtsModel(id) ?? { id, name: id, kind: "tts" });
    }
    return models.length ? { models, source: "api" } : fallback();
  } finally {
    sent.clear();
  }
}
