// Pollinations native audio, staged only (#2034).
// OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// config/audioRegistry.ts, handlers/audioSpeech.ts, handlers/audioTranscription.ts,
// utils/audioMultipart.ts under open-sse/. See the nested report for restrictions.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult, errorEnvelopeMessage } from "../../../utils/error.js";
import { isFunction, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  POLLINATIONS_MAX_STT_FILE_BYTES, POLLINATIONS_MAX_TRANSCRIPT_BYTES, POLLINATIONS_PROVIDER_ID, POLLINATIONS_STT_MODELS, POLLINATIONS_STT_TIMEOUT_MS,
  POLLINATIONS_TRANSCRIPTION_URL, pollinationsSttModel,
} from "./config.js";
import { discard, invalid, lostResult, pollinationsToken, sendOnce, withAcceptedJob } from "./http.js";

const MODALITY = "stt";
const LABEL = "transcription";
/** Union of every model's response formats. */
export const POLLINATIONS_TRANSCRIPTION_RESPONSE_FORMATS = Object.freeze(["json", "text", "verbose_json"]);
const JSON_FORMATS = new Set(["json", "verbose_json"]);
const GRANULARITY_FIELDS = Object.freeze(["timestamp_granularities[]", "timestamp_granularities"]);
const MAX_FILE_NAME = 255;
const MAX_TEXT_FIELD = 4096;
const CORS = { "Access-Control-Allow-Origin": "*" };

const field = (formData, name) => (isFunction(formData?.get) ? formData.get(name) : null);
const fields = (formData, name) => (isFunction(formData?.getAll) ? formData.getAll(name) : []);

/** Source getUploadedFileName plus buildMultipartBody's quote and CR/LF replacement. */
export function pollinationsUploadFileName(file) {
  const raw = isString(file?.name) ? file.name.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, MAX_FILE_NAME) : "";
  const name = raw ? raw.replace(/\.opus$/i, ".ogg") : "audio.wav";
  return name.replace(/["]/g, "_").replace(/[\r\n]/g, "_");
}

function optionalText(formData, name) {
  const value = field(formData, name);
  if (value === null || value === "") return { value: null };
  if (!isString(value)) return { error: `Pollinations transcription ${name} must be text` };
  if (value.length > MAX_TEXT_FIELD) return { error: `Pollinations transcription ${name} is too long` };
  return { value };
}

/**
 * Check a transcription request and build the source's multipart body.
 *
 * @returns {Promise<{ body: FormData, responseFormat: string } | object>} the body, or a 400 error result with `local: true`
 */
export async function buildPollinationsTranscriptionRequest(model, formData, { kind = "transcription" } = {}) {
  if (kind !== "transcription") return invalid("Pollinations audio translations are not supported here");
  const entry = pollinationsSttModel(model);
  if (!entry) return invalid(`Unsupported Pollinations transcription model: ${model}. Use one of: ${POLLINATIONS_STT_MODELS.map((m) => m.id).join(", ")}`);
  const file = field(formData, "file");
  if (!file || !isFunction(file.arrayBuffer)) {
    return invalid(field(formData, "url") !== null ? "Pollinations transcription takes an uploaded file, not a url" : "Missing required field: file");
  }
  const stream = field(formData, "stream");
  if (stream !== null && String(stream).toLowerCase() !== "false") return invalid("Pollinations transcription does not support streaming");

  const requested = field(formData, "response_format");
  const responseFormat = requested === null || requested === "" ? "json" : String(requested).trim().toLowerCase();
  if (!entry.responseFormats.includes(responseFormat)) {
    return invalid(`Pollinations model ${entry.id} supports response_format ${entry.responseFormats.join(", ")}`);
  }

  const granularities = [...new Set(GRANULARITY_FIELDS.flatMap((name) => fields(formData, name))
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean))];
  if (granularities.length && !entry.timestamps) return invalid(`Pollinations model ${entry.id} does not return timestamps`);
  if (granularities.length && responseFormat !== "verbose_json") return invalid("Pollinations timestamp_granularities need response_format verbose_json");
  for (const granularity of granularities) {
    if (granularity !== "segment" && granularity !== "word") return invalid("Pollinations timestamp_granularities supports segment and word");
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
      return invalid("Pollinations transcription temperature must be a number from 0 to 1");
    }
    temperature = rawTemperature.trim();
  }

  if (Number.isFinite(file.size) && file.size > POLLINATIONS_MAX_STT_FILE_BYTES) return invalid("Pollinations transcription file is too large");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) return invalid("Pollinations transcription file is empty");
  if (bytes.length > POLLINATIONS_MAX_STT_FILE_BYTES) return invalid("Pollinations transcription file is too large");

  const body = new FormData();
  body.append("model", entry.id);
  if (language.value !== null) body.append("language", language.value);
  if (prompt.value !== null) body.append("prompt", prompt.value);
  if (requested !== null && requested !== "") body.append("response_format", responseFormat);
  if (temperature !== null) body.append("temperature", temperature);
  for (const granularity of granularities) body.append("timestamp_granularities[]", granularity);
  const type = isString(file.type) && file.type && !/[\r\n]/.test(file.type) ? file.type : "application/octet-stream";
  body.append("file", new Blob([bytes], { type }), pollinationsUploadFileName(file));
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
export function createPollinationsSttAdapter({ fetchImpl, timeoutMs = POLLINATIONS_STT_TIMEOUT_MS, maxTranscriptBytes = POLLINATIONS_MAX_TRANSCRIPT_BYTES } = {}) {
  return {
    provider: POLLINATIONS_PROVIDER_ID,
    models: POLLINATIONS_STT_MODELS,
    responseFormats: POLLINATIONS_TRANSCRIPTION_RESPONSE_FORMATS,
    /**
     * STT core result contract (sttCore.js): `{ success: true, response,
     * usageValue, nativeUnits, accounting }`, or an error result; `local` marks
     * caller input errors and `acceptedJob` marks a request Pollinations may have
     * processed and billed.
     */
    async transcribe({ model, formData, credentials, kind, signal }) {
      const started = Date.now();
      if (signal?.aborted) return { ...createErrorResult(499, "Pollinations transcription aborted before submission"), local: true };
      let stop;
      let timer;
      const bounded = new Promise((resolve) => {
        stop = () => resolve({ ...createErrorResult(499, "Pollinations transcription aborted before submission"), local: true });
        signal?.addEventListener("abort", stop, { once: true });
        timer = setTimeout(() => resolve({ ...createErrorResult(504, "Pollinations transcription preparation timed out"), local: true }), Math.max(1, timeoutMs));
      });
      let built;
      try {
        built = await Promise.race([buildPollinationsTranscriptionRequest(model, formData, { kind }), bounded]);
      } catch {
        return invalid("Pollinations transcription upload could not be read");
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
      }
      if (!built.body) return built;
      const token = pollinationsToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable Pollinations API key on this connection");
      const sent = await sendOnce(POLLINATIONS_TRANSCRIPTION_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: built.body,
      }, { modality: MODALITY, label: LABEL, credentials, signal, timeoutMs: Math.max(1, timeoutMs - (Date.now() - started)), fetchImpl });
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
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Pollinations transcription request aborted after it was sent"), MODALITY, "accepted");
          if (sent.timedOut()) return lostResult(MODALITY, LABEL, "transcript did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT);
          return lostResult(MODALITY, LABEL, "transcript was unreadable or too large");
        }
        const accounting = mediaAccounting(null, POLLINATIONS_PROVIDER_ID, MODALITY);
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
        if (errorEnvelopeMessage(data)) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Pollinations transcription answered with an error payload");
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
