// NanoGPT native transcription: one OpenAI-compatible multipart POST to
// https://nano-gpt.com/api/v1/audio/transcriptions. Staged for
// /v1/audio/transcriptions and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/audioTranscription.ts handleAudioTranscription default
// branch (header `Authorization: Bearer <key>`, multipart fields `model`, then
// `language`, `prompt`, `response_format`, `temperature`,
// `timestamp_granularities[]` when present, then `file`; the answer is passed
// through with its content type), open-sse/utils/audioMultipart.ts
// (buildMultipartBody: file name from getUploadedFileName, `.opus` relabelled
// `.ogg`, "audio.wav" when unnamed, `"` and CR/LF replaced by `_`, the file's
// own type or application/octet-stream) and open-sse/config/audioRegistry.ts
// (`nanogpt` transcription row: whisper-1, gpt-4o-transcription).
//
// Fork deviations: see ./http.js for transport; in addition only the two
// source models; translations, streaming, srt/vtt/diarized_json and unknown
// response formats, verbose_json and timestamp granularities on
// gpt-4o-transcription, granularities without verbose_json, an out-of-range
// temperature, a missing, empty or oversized file, and a `url` input are
// refused before submit; every valid granularity is sent (the source sent only
// the first); other client fields are not forwarded, as in the source; a JSON
// answer must be an object with a string `text`, and a text answer must not be
// JSON or HTML.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult, errorEnvelopeMessage } from "../../../utils/error.js";
import { isFunction, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  NANOGPT_MAX_STT_FILE_BYTES, NANOGPT_MAX_TRANSCRIPT_BYTES, NANOGPT_PROVIDER_ID, NANOGPT_STT_MODELS, NANOGPT_STT_TIMEOUT_MS,
  NANOGPT_TRANSCRIPTION_URL, nanogptSttModel,
} from "./config.js";
import { discard, invalid, lostResult, nanogptToken, sendOnce, withAcceptedJob } from "./http.js";

const MODALITY = "stt";
const LABEL = "transcription";
/** Union of every model's response formats. */
export const NANOGPT_TRANSCRIPTION_RESPONSE_FORMATS = Object.freeze(["json", "text", "verbose_json"]);
const JSON_FORMATS = new Set(["json", "verbose_json"]);
const GRANULARITY_FIELDS = Object.freeze(["timestamp_granularities[]", "timestamp_granularities"]);
const MAX_FILE_NAME = 255;
const MAX_TEXT_FIELD = 4096;
const CORS = { "Access-Control-Allow-Origin": "*" };

const field = (formData, name) => (isFunction(formData?.get) ? formData.get(name) : null);
const fields = (formData, name) => (isFunction(formData?.getAll) ? formData.getAll(name) : []);

/** Source getUploadedFileName plus buildMultipartBody's quote and CR/LF replacement. */
export function nanogptUploadFileName(file) {
  const raw = isString(file?.name) ? file.name.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, MAX_FILE_NAME) : "";
  const name = raw ? raw.replace(/\.opus$/i, ".ogg") : "audio.wav";
  return name.replace(/["]/g, "_").replace(/[\r\n]/g, "_");
}

function optionalText(formData, name) {
  const value = field(formData, name);
  if (value === null || value === "") return { value: null };
  if (!isString(value)) return { error: `NanoGPT transcription ${name} must be text` };
  if (value.length > MAX_TEXT_FIELD) return { error: `NanoGPT transcription ${name} is too long` };
  return { value };
}

/**
 * Check a transcription request and build the source's multipart body.
 *
 * @returns {Promise<{ body: FormData, responseFormat: string } | object>} the body, or a 400 error result with `local: true`
 */
export async function buildNanogptTranscriptionRequest(model, formData, { kind = "transcription" } = {}) {
  if (kind !== "transcription") return invalid("NanoGPT audio translations are not supported here");
  const entry = nanogptSttModel(model);
  if (!entry) return invalid(`Unsupported NanoGPT transcription model: ${model}. Use one of: ${NANOGPT_STT_MODELS.map((m) => m.id).join(", ")}`);
  const file = field(formData, "file");
  if (!file || !isFunction(file.arrayBuffer)) {
    return invalid(field(formData, "url") !== null ? "NanoGPT transcription takes an uploaded file, not a url" : "Missing required field: file");
  }
  const stream = field(formData, "stream");
  if (stream !== null && String(stream).toLowerCase() !== "false") return invalid("NanoGPT transcription does not support streaming");

  const requested = field(formData, "response_format");
  const responseFormat = requested === null || requested === "" ? "json" : String(requested).trim().toLowerCase();
  if (!entry.responseFormats.includes(responseFormat)) {
    return invalid(`NanoGPT model ${entry.id} supports response_format ${entry.responseFormats.join(", ")}`);
  }

  const granularities = [...new Set(GRANULARITY_FIELDS.flatMap((name) => fields(formData, name))
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean))];
  if (granularities.length && !entry.timestamps) return invalid(`NanoGPT model ${entry.id} does not return timestamps`);
  if (granularities.length && responseFormat !== "verbose_json") return invalid("NanoGPT timestamp_granularities need response_format verbose_json");
  for (const granularity of granularities) {
    if (granularity !== "segment" && granularity !== "word") return invalid("NanoGPT timestamp_granularities supports segment and word");
  }

  const language = optionalText(formData, "language");
  if (language.error) return invalid(language.error);
  const prompt = optionalText(formData, "prompt");
  if (prompt.error) return invalid(prompt.error);
  const rawTemperature = field(formData, "temperature");
  let temperature = null;
  if (rawTemperature !== null && rawTemperature !== "") {
    const number = Number(rawTemperature);
    if (!isString(rawTemperature) || !rawTemperature.trim() || !Number.isFinite(number) || number < 0 || number > 1) {
      return invalid("NanoGPT transcription temperature must be a number from 0 to 1");
    }
    temperature = rawTemperature.trim();
  }

  if (Number.isFinite(file.size) && file.size > NANOGPT_MAX_STT_FILE_BYTES) return invalid("NanoGPT transcription file is too large");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) return invalid("NanoGPT transcription file is empty");
  if (bytes.length > NANOGPT_MAX_STT_FILE_BYTES) return invalid("NanoGPT transcription file is too large");

  const body = new FormData();
  body.append("model", entry.id);
  if (language.value !== null) body.append("language", language.value);
  if (prompt.value !== null) body.append("prompt", prompt.value);
  if (requested !== null && requested !== "") body.append("response_format", responseFormat);
  if (temperature !== null) body.append("temperature", temperature);
  for (const granularity of granularities) body.append("timestamp_granularities[]", granularity);
  const type = isString(file.type) && file.type && !/[\r\n]/.test(file.type) ? file.type : "application/octet-stream";
  body.append("file", new Blob([bytes], { type }), nanogptUploadFileName(file));
  return { body, responseFormat };
}

/** Provider usage and audio seconds, kept only when well formed. */
function usageOf(data) {
  const usage = isRecord(data.usage) ? data.usage : null;
  const duration = data.duration ?? (usage?.type === "duration" ? usage.seconds : undefined);
  return {
    usageValue: usage ? { usage } : undefined,
    nativeUnits: isNumber(duration) && Number.isFinite(duration) && duration >= 0 ? { audioSeconds: duration } : {},
  };
}

/** Whether text parses as a JSON object or array (a transcript like "[music] hi" does not). */
function looksLikeJsonDocument(text) {
  try {
    const value = JSON.parse(text);
    return isRecord(value) || Array.isArray(value);
  } catch {
    return false;
  }
}

const textResponse = (text) => new Response(text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } });

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.timeoutMs] - deadline for the request and its body
 * @param {number} [options.maxTranscriptBytes]
 */
export function createNanogptSttAdapter({ fetchImpl, timeoutMs = NANOGPT_STT_TIMEOUT_MS, maxTranscriptBytes = NANOGPT_MAX_TRANSCRIPT_BYTES } = {}) {
  return {
    provider: NANOGPT_PROVIDER_ID,
    models: NANOGPT_STT_MODELS,
    responseFormats: NANOGPT_TRANSCRIPTION_RESPONSE_FORMATS,
    /**
     * STT core result contract (sttCore.js): `{ success: true, response,
     * usageValue, nativeUnits, accounting }`, or an error result; `local` marks
     * caller input errors and `acceptedJob` marks a request NanoGPT may have
     * processed and billed.
     */
    async transcribe({ model, formData, credentials, kind, signal }) {
      const built = await buildNanogptTranscriptionRequest(model, formData, { kind });
      if (!built.body) return built;
      const token = nanogptToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable NanoGPT API key on this connection");
      const sent = await sendOnce(NANOGPT_TRANSCRIPTION_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: built.body,
      }, { modality: MODALITY, label: LABEL, credentials, signal, timeoutMs, fetchImpl });
      if (sent.failure) return sent.failure;
      const { response, fetchSignal } = sent;
      try {
        const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        const isJson = /(^application\/json$|\+json$)/.test(contentType);
        if (/html/.test(contentType) || (!isJson && JSON_FORMATS.has(built.responseFormat))) {
          discard(response);
          return lostResult(MODALITY, LABEL, `answered without a ${built.responseFormat} transcript`);
        }
        let text;
        try {
          text = (await readBounded(response.body, maxTranscriptBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY)).toString("utf8");
        } catch {
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "NanoGPT transcription request aborted after it was sent"), MODALITY, "accepted");
          if (sent.timedOut()) return lostResult(MODALITY, LABEL, "transcript did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT);
          return lostResult(MODALITY, LABEL, "transcript was unreadable or too large");
        }
        const accounting = mediaAccounting(null, NANOGPT_PROVIDER_ID, MODALITY);
        accounting.meta = { model: built.body.get("model"), responseFormat: built.responseFormat };
        if (!isJson) {
          // A text answer must be the transcript itself, not a JSON or HTML document.
          if (/^\s*<(!doctype|html)/i.test(text) || looksLikeJsonDocument(text)) {
            return lostResult(MODALITY, LABEL, "returned an unreadable transcript");
          }
          // Plain text has no usage or duration.
          return { success: true, response: textResponse(text), usageValue: undefined, nativeUnits: {}, accounting };
        }
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          // The parser's message quotes the body, so it is dropped.
        }
        if (!isRecord(data)) return lostResult(MODALITY, LABEL, "returned an unreadable transcript");
        // An error envelope produced no transcript (9router #5864); its text is not quoted.
        if (errorEnvelopeMessage(data)) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "NanoGPT transcription answered with an error payload");
        if (!isString(data.text)) return lostResult(MODALITY, LABEL, "returned no transcript text");
        if (built.responseFormat === "text") return { success: true, response: textResponse(data.text), ...usageOf(data), accounting };
        return {
          success: true,
          response: new Response(text, { status: 200, headers: { "Content-Type": "application/json", ...CORS } }),
          ...usageOf(data),
          accounting,
        };
      } finally {
        sent.clear();
      }
    },
  };
}
