// Kie native text-to-speech: one createTask, a bounded recordInfo poll, then
// the finished audio downloaded from its public result URL without the key.
// Staged for /v1/audio/speech and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/audioSpeech.ts handleKieAudioSpeech (submit body
// `{ model, callBackUrl, input: { text, voice, stability, similarity_boost,
// style, speed, timestamps, previous_text, next_text, language_code } }` with
// the defaults 0.5 / 0.75 / 0 / 1 / false / "" / "" / ""), pollKieAudioResult
// (60 s, 2 s interval), normalizeKieElevenLabsVoice (OpenAI voice aliases,
// default Rachel) and findKieAudioUrl (result URL keys, image URLs skipped).
//
// Fork deviations: see ./task.js for transport; in addition the two speech
// models only (dialogue and sound-effect rows are refused, ./config.js says
// why); a caller callback URL is refused (this gateway polls, and a caller URL
// would receive the result); `timestamps: true`, streaming and any named
// container other than mp3 (or the json wrapper) are refused before submit;
// numeric and text tuning fields are type-checked before submit; the result
// URL is read from the source's named keys only (no recursive scan of every
// value, which could pick an echoed callback), must be public https, and is
// downloaded with no credential, no redirects, a byte cap and an audio
// magic-byte check.
import { Buffer } from "node:buffer";
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { guardedProbeFetch } from "../../../utils/outboundUrlGuard.js";
import { fetchPublic, isBlockedHost } from "../../../../src/shared/utils/ssrfGuard.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  KIE_DEFAULT_VOICE, KIE_DOWNLOAD_TIMEOUT_MS, KIE_EXCLUDED_MODELS, KIE_MAX_AUDIO_BYTES, KIE_MAX_TTS_REQUEST_BYTES,
  KIE_PLACEHOLDER_CALLBACK_URL, KIE_PROVIDER_ID, KIE_TTS_MODELS, KIE_TTS_TIMEOUT_MS, KIE_VOICE_ALIASES, kieTtsModel,
} from "./config.js";
import { discard, withAcceptedJob } from "./http.js";
import { parseKieResultJson, runKieTask } from "./task.js";

const MODALITY = "tts";
const MAX_URL_LENGTH = 4096;
/** Containers this adapter can honor whatever Kie returns: none named, the json wrapper, or mp3 (checked after download). */
export const KIE_SPEECH_RESPONSE_FORMATS = Object.freeze(["mp3", "json"]);
const NUMBER_FIELDS = Object.freeze({ stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1 });
const TEXT_FIELDS = Object.freeze(["previous_text", "next_text", "language_code"]);
const CALLBACK_FIELDS = Object.freeze(["callBackUrl", "callback_url", "callbackUrl"]);
// Source findAudioUrlDeep preferred keys.
const URL_KEYS = Object.freeze(["audio_url", "audioUrl", "stream_audio_url", "streamAudioUrl", "resultUrl", "url", "downloadUrl", "resultUrls"]);
const IMAGE_URL_RE = /\.(jpg|jpeg|png|webp|gif|svg)(\?|$)/i;
const AUDIO_MIME = /^(audio\/[a-z0-9.+-]+|application\/octet-stream|binary\/octet-stream)$/;

const reject = (message) => Object.assign(new Error(message), { status: HTTP_STATUS.BAD_REQUEST });

/** Source normalizeKieElevenLabsVoice. */
export function normalizeKieVoice(voice) {
  const value = isString(voice) ? voice.trim() : "";
  return KIE_VOICE_ALIASES[value.toLowerCase()] || value || KIE_DEFAULT_VOICE;
}

/** `{ modelId, voice }` from `model` or `model/voice`, or a 400 error. */
function resolveModel(model) {
  if (!isString(model) || !model) throw reject("Kie speech needs a model");
  const excluded = Object.keys(KIE_EXCLUDED_MODELS).find((id) => model === id || model.startsWith(`${id}/`));
  if (excluded) throw reject(`Kie model ${excluded} is not supported for speech here: ${KIE_EXCLUDED_MODELS[excluded].reason}`);
  for (const entry of KIE_TTS_MODELS) {
    if (model === entry.id) return { modelId: entry.id, voice: null };
    if (model.startsWith(`${entry.id}/`)) return { modelId: entry.id, voice: model.slice(entry.id.length + 1) };
  }
  throw reject(`Unsupported Kie speech model: ${model}. Use one of: ${KIE_TTS_MODELS.map((m) => m.id).join(", ")}`);
}

/**
 * The source's Kie speech task body for an OpenAI-style speech request.
 * Throws a 400 error for an unknown model or an input this subset cannot honor.
 *
 * @param {string} model - `modelId` or `modelId/voice`
 * @param {string} text - the speech input
 * @param {object} [options] - the rest of the speech request
 */
export function buildKieSpeechRequest(model, text, options = {}) {
  const { modelId, voice: modelVoice } = resolveModel(model);
  if (!kieTtsModel(modelId)) throw reject(`Unsupported Kie speech model: ${model}`);
  if (!isString(text) || !text.trim()) throw reject("Kie speech needs input text");
  if (options.stream === true || options.stream_format === "sse") throw reject("Kie speech does not support streaming");
  if (options.timestamps !== undefined && options.timestamps !== false) {
    throw reject("Kie speech timestamps are not supported; this route returns audio only");
  }
  if (CALLBACK_FIELDS.some((field) => options[field] !== undefined)) {
    throw reject("Kie speech callbacks are not supported; the gateway polls the task");
  }
  if (options.voice !== undefined && !isString(options.voice)) throw reject("Kie speech voice must be a string");
  if (modelVoice && isString(options.voice) && options.voice.trim() && options.voice.trim() !== modelVoice) {
    throw reject("Kie speech voice is named twice with different values");
  }
  const tuning = {};
  for (const [field, fallback] of Object.entries(NUMBER_FIELDS)) {
    const value = options[field];
    if (value !== undefined && (!isNumber(value) || !Number.isFinite(value))) throw reject(`Kie speech ${field} must be a finite number`);
    tuning[field] = value ?? fallback;
  }
  const texts = {};
  for (const field of TEXT_FIELDS) {
    const value = options[field];
    if (value !== undefined && value !== null && !isString(value)) throw reject(`Kie speech ${field} must be a string`);
    texts[field] = value || "";
  }
  const request = {
    model: modelId,
    callBackUrl: KIE_PLACEHOLDER_CALLBACK_URL,
    input: {
      text,
      voice: normalizeKieVoice(isString(options.voice) && options.voice.trim() ? options.voice : modelVoice),
      stability: tuning.stability,
      similarity_boost: tuning.similarity_boost,
      style: tuning.style,
      speed: tuning.speed,
      timestamps: false,
      previous_text: texts.previous_text,
      next_text: texts.next_text,
      language_code: texts.language_code,
    },
  };
  if (Buffer.byteLength(JSON.stringify(request)) > KIE_MAX_TTS_REQUEST_BYTES) throw reject("Kie speech request is too large");
  return request;
}

/** An https URL on a public literal host without userinfo, or null. */
export function kiePublicUrl(raw) {
  if (!isString(raw) || raw.length > MAX_URL_LENGTH) return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || isBlockedHost(url.hostname)) return null;
  return url.href;
}

function urlFrom(value) {
  if (isString(value)) return !IMAGE_URL_RE.test(value) && /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = isString(item) ? urlFrom(item) : null;
      if (url) return url;
    }
  }
  return null;
}

/**
 * The finished audio URL from a recordInfo record (or a synchronous submit
 * answer), using the source's candidate objects and named keys only.
 * Returns the first named URL, checked as public https, or null.
 */
export function findKieAudioUrl(record) {
  const data = isRecord(record?.data) ? record.data : {};
  const resultJson = parseKieResultJson(record);
  const list = (value) => (Array.isArray(value) ? value : []);
  const candidates = [
    data.response, data, resultJson,
    ...list(data.response), ...list(data.data), ...list(resultJson.data), ...list(resultJson.result),
  ].filter(isRecord);
  for (const candidate of candidates) {
    for (const key of URL_KEYS) {
      const url = urlFrom(candidate[key]);
      if (url) return kiePublicUrl(url);
    }
  }
  return null;
}

/** Audio container from magic bytes, or null. */
export function sniffAudioFormat(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return (bytes[1] & 0x06) === 0 ? "aac" : "mp3";
  }
  const ascii = (start, end) => bytes.subarray(start, end).toString("latin1");
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "wav";
  if (bytes.length >= 4 && ascii(0, 4) === "OggS") return "ogg";
  if (bytes.length >= 4 && ascii(0, 4) === "fLaC") return "flac";
  if (bytes.length >= 8 && ascii(4, 8) === "ftyp") return "mp4";
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  return null;
}

/**
 * Download the finished audio without any credential: https only, the
 * public-only URL and connection-time DNS guards, no redirects, a byte cap
 * and a magic-byte check. Every failure is a lost result of a finished
 * (billable) task, so it carries `acceptedJob`; messages are fixed.
 */
export async function downloadKieAudio(url, { signal, timeoutMs = KIE_DOWNLOAD_TIMEOUT_MS, maxBytes = KIE_MAX_AUDIO_BYTES } = {}) {
  const lost = (message, status = HTTP_STATUS.BAD_GATEWAY) =>
    withAcceptedJob(createErrorResult(status, `Kie speech audio ${message}`), MODALITY, "accepted");
  const aborted = () => withAcceptedJob(createErrorResult(499, "Kie speech request aborted"), MODALITY, "accepted");
  const timeout = AbortSignal.timeout(Math.max(1, timeoutMs));
  const fetchSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetchPublic(url, { method: "GET", headers: { Accept: "audio/*" }, signal: fetchSignal }, {
      maxRedirects: 0,
      fetchImpl: (target, init) => guardedProbeFetch(target, init, "public-only"),
    });
  } catch {
    if (signal?.aborted) return aborted();
    return timeout.aborted ? lost("download timed out", HTTP_STATUS.GATEWAY_TIMEOUT) : lost("download was refused or failed");
  }
  if (response.status !== 200) {
    discard(response);
    return lost(`download returned ${response.status}`);
  }
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type && !AUDIO_MIME.test(type)) {
    discard(response);
    return lost("download is not audio");
  }
  let bytes;
  try {
    bytes = await readBounded(response.body, maxBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY);
  } catch {
    if (signal?.aborted) return aborted();
    return timeout.aborted ? lost("download timed out", HTTP_STATUS.GATEWAY_TIMEOUT) : lost("was unreadable or too large");
  }
  if (bytes.length === 0) return lost("was empty");
  const format = sniffAudioFormat(bytes);
  if (!format) return lost("is not a recognized audio file");
  return { success: true, bytes, format };
}

/**
 * @param {object} [options] - task and download bounds and clock, for tests; see runKieTask
 */
export function createKieTtsAdapter({ downloadTimeoutMs, maxAudioBytes, timeoutMs = KIE_TTS_TIMEOUT_MS, ...polling } = {}) {
  return {
    async: true,
    provider: KIE_PROVIDER_ID,
    models: KIE_TTS_MODELS,
    responseFormats: KIE_SPEECH_RESPONSE_FORMATS,
    /**
     * TTS adapter contract (ttsCore.js): `{ base64, format, accounting }` on
     * success, or a full error result, which carries `acceptedJob` when the
     * task may bill.
     */
    async synthesize(text, model, credentials, _responseFormat, options = {}) {
      const { signal, log } = options;
      const requested = options.requestedResponseFormat ?? options.response_format ?? null;
      if (requested != null && !KIE_SPEECH_RESPONSE_FORMATS.includes(requested)) {
        return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Kie speech returns the provider's audio file; omit response_format, or use mp3 or json");
      }
      let payload;
      try {
        payload = buildKieSpeechRequest(model, text, options);
      } catch (error) {
        return createErrorResult(error.status ?? HTTP_STATUS.BAD_REQUEST, error.message);
      }
      const result = await runKieTask({
        ...polling,
        timeoutMs,
        modality: MODALITY,
        label: "speech",
        payload,
        read: findKieAudioUrl,
        credentials,
        signal,
        log,
      });
      if (!result.success) return result;
      const downloaded = await downloadKieAudio(result.value, {
        signal,
        ...(downloadTimeoutMs ? { timeoutMs: downloadTimeoutMs } : null),
        ...(maxAudioBytes ? { maxBytes: maxAudioBytes } : null),
      });
      if (!downloaded.success) return downloaded;
      if (requested === "mp3" && downloaded.format !== "mp3") {
        return withAcceptedJob(
          createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Kie returned ${downloaded.format} audio, not the requested mp3`),
          MODALITY,
          "accepted"
        );
      }
      return {
        base64: Buffer.from(downloaded.bytes).toString("base64"),
        format: downloaded.format,
        accounting: { ...result.accounting, meta: { ...result.accounting.meta, taskId: result.taskId, nativeUnitsSource: "input-characters" } },
      };
    },
  };
}
