// OpenRouter native transcription: one JSON POST to
// https://openrouter.ai/api/v1/audio/transcriptions. Staged for
// /v1/audio/transcriptions and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/openrouterTranscription.ts handleOpenRouterTranscription
// (headers `Authorization: Bearer <key>` and `Content-Type: application/json`;
// body `{ model, input_audio: { data: <base64>, format } }`, then `language`,
// `response_format`, `temperature` as a number and `timestamp_granularities`
// as an array when present; the answer is passed through with its content
// type) and resolveOpenRouterAudioFormat (extension first, `.opus` as "ogg",
// then the base MIME type), selected by the `openrouter-stt` branch of
// open-sse/handlers/audioTranscription.ts.
//
// Fork deviations: see ./http.js for transport; in addition only the eleven
// source models; translations, streaming, srt/vtt and unknown response
// formats, timestamp granularities without verbose_json or other than
// segment/word, an out-of-range temperature, a non-empty `prompt` (the source
// drops it silently), a missing, empty or oversized file, a `url` input, and
// audio whose container is not recognisable are refused before submit. The
// source announced unrecognisable audio as "wav"; here the leading bytes are
// checked when the name and MIME type say nothing, and the request is refused
// when they do not match a supported container either. A JSON answer must be
// an object with a string `text`, and a text answer must not be JSON or HTML.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult, errorEnvelopeMessage } from "../../../utils/error.js";
import { isFunction, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  OPENROUTER_MAX_STT_FILE_BYTES, OPENROUTER_MAX_TRANSCRIPT_BYTES, OPENROUTER_PROVIDER_ID, OPENROUTER_STT_AUDIO_FORMATS,
  OPENROUTER_STT_MODELS, OPENROUTER_STT_TIMEOUT_MS, OPENROUTER_TRANSCRIPTION_URL, openrouterSttModel,
} from "./config.js";
import { discard, invalid, lostResult, openrouterToken, sendOnce, withAcceptedJob } from "./http.js";

export const OPENROUTER_TRANSCRIPTION_RESPONSE_FORMATS = Object.freeze(["json", "text", "verbose_json"]);
const JSON_FORMATS = new Set(["json", "verbose_json"]);
const GRANULARITY_FIELDS = Object.freeze(["timestamp_granularities[]", "timestamp_granularities"]);
const MAX_TEXT_FIELD = 4096;

/** Source MIME map (base type only, codec parameters dropped). */
const MIME_FORMATS = Object.freeze({
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/webm": "webm",
  "audio/aac": "aac",
});

const field = (formData, name) => (isFunction(formData?.get) ? formData.get(name) : null);
const fields = (formData, name) => (isFunction(formData?.getAll) ? formData.getAll(name) : []);

/** Container from the leading bytes, or null. Used only when name and MIME type say nothing. */
export function sniffOpenRouterAudioFormat(bytes) {
  if (!bytes || bytes.length < 4) return null;
  const ascii = (start, end) => bytes.subarray(start, end).toString("latin1");
  if (ascii(0, 4) === "RIFF" && bytes.length >= 12 && ascii(8, 12) === "WAVE") return "wav";
  if (ascii(0, 4) === "fLaC") return "flac";
  if (ascii(0, 4) === "OggS") return "ogg";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "webm";
  if (bytes.length >= 8 && ascii(4, 8) === "ftyp") return "m4a";
  if (ascii(0, 3) === "ID3") return "mp3";
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return "aac"; // ADTS: sync word, layer 00
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0) return "mp3"; // MPEG audio frame
  return null;
}

/**
 * Source resolveOpenRouterAudioFormat (extension, `.opus` as "ogg", then base
 * MIME type), except that the "wav" fallback is replaced by a byte check and
 * null when nothing matches.
 */
export function resolveOpenRouterAudioFormat(file, bytes = null) {
  const fileName = isString(file?.name) ? file.name.toLowerCase() : "";
  const extension = fileName.includes(".") ? fileName.split(".").pop() || "" : "";
  if (extension === "opus") return "ogg";
  if (OPENROUTER_STT_AUDIO_FORMATS.includes(extension)) return extension;
  const mimeType = (isString(file?.type) ? file.type : "").split(";")[0].trim().toLowerCase();
  return MIME_FORMATS[mimeType] ?? sniffOpenRouterAudioFormat(bytes);
}

function optionalText(formData, name) {
  const value = field(formData, name);
  if (value === null || value === "") return { value: null };
  if (!isString(value)) return { error: `OpenRouter transcription ${name} must be text` };
  if (value.length > MAX_TEXT_FIELD) return { error: `OpenRouter transcription ${name} is too long` };
  return { value };
}

/**
 * Check a transcription request and build the source's JSON body.
 *
 * @returns {Promise<{ body: object, responseFormat: string } | object>} the body, or a 400 error result with `local: true`
 */
export async function buildOpenRouterTranscriptionRequest(model, formData, { kind = "transcription" } = {}) {
  if (kind !== "transcription") return invalid("OpenRouter audio translations are not supported");
  const entry = openrouterSttModel(model);
  if (!entry) return invalid(`Unsupported OpenRouter transcription model: ${model}. Use one of: ${OPENROUTER_STT_MODELS.map((m) => m.id).join(", ")}`);
  const file = field(formData, "file");
  if (!file || !isFunction(file.arrayBuffer)) {
    return invalid(field(formData, "url") !== null ? "OpenRouter transcription takes an uploaded file, not a url" : "Missing required field: file");
  }
  const stream = field(formData, "stream");
  if (stream !== null && String(stream).toLowerCase() !== "false") return invalid("OpenRouter transcription does not support streaming");

  const requested = field(formData, "response_format");
  const responseFormat = requested === null || requested === "" ? "json" : String(requested).trim().toLowerCase();
  if (!OPENROUTER_TRANSCRIPTION_RESPONSE_FORMATS.includes(responseFormat)) {
    return invalid(`OpenRouter transcription supports response_format ${OPENROUTER_TRANSCRIPTION_RESPONSE_FORMATS.join(", ")}`);
  }

  const granularities = [...new Set(GRANULARITY_FIELDS.flatMap((name) => fields(formData, name))
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean))];
  if (granularities.length && responseFormat !== "verbose_json") return invalid("OpenRouter timestamp_granularities need response_format verbose_json");
  if (granularities.some((value) => value !== "segment" && value !== "word")) return invalid("OpenRouter timestamp_granularities supports segment and word");

  const language = optionalText(formData, "language");
  if (language.error) return invalid(language.error);
  const prompt = optionalText(formData, "prompt");
  if (prompt.error) return invalid(prompt.error);
  if (prompt.value !== null) return invalid("OpenRouter transcription does not accept a prompt");

  const rawTemperature = field(formData, "temperature");
  let temperature = null;
  if (rawTemperature !== null && rawTemperature !== "") {
    const number = Number(rawTemperature);
    if (!isString(rawTemperature) || !rawTemperature.trim() || !Number.isFinite(number) || number < 0 || number > 1) {
      return invalid("OpenRouter transcription temperature must be a number from 0 to 1");
    }
    temperature = number;
  }

  if (Number.isFinite(file.size) && file.size > OPENROUTER_MAX_STT_FILE_BYTES) return invalid("OpenRouter transcription file is too large");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) return invalid("OpenRouter transcription file is empty");
  if (bytes.length > OPENROUTER_MAX_STT_FILE_BYTES) return invalid("OpenRouter transcription file is too large");
  const format = resolveOpenRouterAudioFormat(file, bytes);
  if (!format) return invalid(`OpenRouter transcription supports audio as ${OPENROUTER_STT_AUDIO_FORMATS.join(", ")}`);

  const body = { model: entry.id, input_audio: { data: bytes.toString("base64"), format } };
  if (language.value !== null) body.language = language.value;
  if (requested !== null && requested !== "") body.response_format = responseFormat;
  if (temperature !== null) body.temperature = temperature;
  if (granularities.length) body.timestamp_granularities = granularities;
  return { body, responseFormat };
}

/** Provider usage and audio seconds, kept only when well formed. Cost is never read as USD. */
function usageOf(data) {
  const usage = isRecord(data.usage) ? data.usage : null;
  const duration = data.duration ?? usage?.seconds;
  return {
    usageValue: usage ? { usage } : undefined,
    nativeUnits: isNumber(duration) && Number.isFinite(duration) && duration >= 0 ? { audioSeconds: duration } : {},
  };
}

const textResponse = (text) => new Response(text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" } });

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.timeoutMs] - deadline for the request and its body
 * @param {number} [options.maxTranscriptBytes] - cap on the answer body
 */
export function createOpenRouterSttAdapter({ fetchImpl, timeoutMs = OPENROUTER_STT_TIMEOUT_MS, maxTranscriptBytes = OPENROUTER_MAX_TRANSCRIPT_BYTES } = {}) {
  return {
    provider: OPENROUTER_PROVIDER_ID,
    models: OPENROUTER_STT_MODELS,
    responseFormats: OPENROUTER_TRANSCRIPTION_RESPONSE_FORMATS,
    /**
     * STT core result contract (sttCore.js): `{ success: true, response,
     * usageValue, nativeUnits, accounting }`, or an error result; `local` marks
     * caller input errors and `acceptedJob` marks a request OpenRouter may have
     * processed and billed.
     */
    async transcribe({ model, formData, credentials, kind, signal }) {
      const built = await buildOpenRouterTranscriptionRequest(model, formData, { kind });
      if (!built.body) return built;
      const token = openrouterToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable OpenRouter API key on this connection");
      const sent = await sendOnce(OPENROUTER_TRANSCRIPTION_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(built.body),
      }, { credentials, signal, timeoutMs, fetchImpl });
      if (sent.failure) return sent.failure;
      const { response, fetchSignal } = sent;
      try {
        const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        const isJson = /(^application\/json$|\+json$)/.test(contentType);
        if (/html/.test(contentType) || (!isJson && JSON_FORMATS.has(built.responseFormat))) {
          discard(response);
          return lostResult(`answered without a ${built.responseFormat} transcript`);
        }
        let text;
        try {
          text = (await readBounded(response.body, maxTranscriptBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY)).toString("utf8");
        } catch {
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "OpenRouter transcription request aborted after it was sent"), "accepted");
          if (sent.timedOut()) return lostResult("transcript did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT);
          return lostResult("transcript was unreadable or too large");
        }
        const accounting = mediaAccounting(null, OPENROUTER_PROVIDER_ID, "stt");
        accounting.meta = { model, responseFormat: built.responseFormat };
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          // The parser's message quotes the body, so it is dropped.
        }
        // A mislabelled JSON object (an error envelope, say) is never returned as transcript text.
        if (!isJson && !isRecord(data)) {
          if (/^\s*<(!doctype|html)/i.test(text)) return lostResult("returned an unreadable transcript");
          return { success: true, response: textResponse(text), usageValue: undefined, nativeUnits: {}, accounting };
        }
        if (!isRecord(data)) return lostResult("returned an unreadable transcript");
        // An error envelope produced no transcript; its text is not quoted.
        if (errorEnvelopeMessage(data)) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "OpenRouter transcription answered with an error payload");
        if (!isString(data.text)) return lostResult("returned no transcript text");
        if (built.responseFormat === "text") return { success: true, response: textResponse(data.text), ...usageOf(data), accounting };
        return {
          success: true,
          response: new Response(text, { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }),
          ...usageOf(data),
          accounting,
        };
      } finally {
        sent.clear();
      }
    },
  };
}
