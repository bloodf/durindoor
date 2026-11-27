// deAPI native transcription: one OpenAI-compatible multipart POST to
// https://oai.deapi.ai/v1/audio/transcriptions. Staged for
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
// (`deapi` transcription row: two models; CT2 adds word timestamps and
// diarized_json).
//
// Fork deviations: see ./http.js for transport; in addition only the two
// source models; translations, streaming, srt/vtt and unknown response
// formats, diarized_json and word timestamps on the non-CT2 model, timestamp
// granularities without verbose_json, an out-of-range temperature, a missing,
// empty or oversized file, and a `url` input are refused before submit; every
// valid granularity is sent (the source sent only the first); other client
// fields are not forwarded, as in the source; a JSON answer must be an object
// with a string `text`, and a text answer must not be JSON or HTML.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult, errorEnvelopeMessage } from "../../../utils/error.js";
import { isFunction, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  DEAPI_MAX_STT_FILE_BYTES, DEAPI_MAX_TRANSCRIPT_BYTES, DEAPI_PROVIDER_ID, DEAPI_STT_MODELS, DEAPI_STT_TIMEOUT_MS,
  DEAPI_TRANSCRIPTION_URL, deapiSttModel,
} from "./config.js";
import { deapiToken, discard, invalid, lostResult, sendOnce, withAcceptedJob } from "./http.js";

const MODALITY = "stt";
const LABEL = "transcription";
export const DEAPI_TRANSCRIPTION_RESPONSE_FORMATS = Object.freeze(["json", "text", "verbose_json", "diarized_json"]);
const JSON_FORMATS = new Set(["json", "verbose_json", "diarized_json"]);
const GRANULARITY_FIELDS = Object.freeze(["timestamp_granularities[]", "timestamp_granularities"]);
const MAX_FILE_NAME = 255;
const MAX_TEXT_FIELD = 4096;

const field = (formData, name) => (isFunction(formData?.get) ? formData.get(name) : null);
const fields = (formData, name) => (isFunction(formData?.getAll) ? formData.getAll(name) : []);

/** Source getUploadedFileName plus buildMultipartBody's quote and CR/LF replacement. */
export function deapiUploadFileName(file) {
  const raw = isString(file?.name) ? file.name.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, MAX_FILE_NAME) : "";
  const name = raw ? raw.replace(/\.opus$/i, ".ogg") : "audio.wav";
  return name.replace(/["]/g, "_").replace(/[\r\n]/g, "_");
}

function optionalText(formData, name) {
  const value = field(formData, name);
  if (value === null || value === "") return { value: null };
  if (!isString(value)) return { error: `deAPI transcription ${name} must be text` };
  if (value.length > MAX_TEXT_FIELD) return { error: `deAPI transcription ${name} is too long` };
  return { value };
}

/**
 * Check a transcription request and build the source's multipart body.
 *
 * @returns {Promise<{ body: FormData, responseFormat: string } | object>} the body, or a 400 error result with `local: true`
 */
export async function buildDeapiTranscriptionRequest(model, formData, { kind = "transcription" } = {}) {
  if (kind !== "transcription") return invalid("deAPI audio translations are not supported here");
  const entry = deapiSttModel(model);
  if (!entry) return invalid(`Unsupported deAPI transcription model: ${model}. Use one of: ${DEAPI_STT_MODELS.map((m) => m.id).join(", ")}`);
  const file = field(formData, "file");
  if (!file || !isFunction(file.arrayBuffer)) {
    return invalid(field(formData, "url") !== null ? "deAPI transcription takes an uploaded file, not a url" : "Missing required field: file");
  }
  const stream = field(formData, "stream");
  if (stream !== null && String(stream).toLowerCase() !== "false") return invalid("deAPI transcription does not support streaming");

  const requested = field(formData, "response_format");
  const responseFormat = requested === null || requested === "" ? "json" : String(requested).trim().toLowerCase();
  if (!DEAPI_TRANSCRIPTION_RESPONSE_FORMATS.includes(responseFormat)) {
    return invalid(`deAPI transcription supports response_format ${DEAPI_TRANSCRIPTION_RESPONSE_FORMATS.join(", ")}`);
  }
  if (responseFormat === "diarized_json" && !entry.diarizedJson) return invalid(`deAPI model ${model} does not return diarized_json`);

  const granularities = [...new Set(GRANULARITY_FIELDS.flatMap((name) => fields(formData, name))
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean))];
  if (granularities.length && responseFormat !== "verbose_json") return invalid("deAPI timestamp_granularities need response_format verbose_json");
  for (const granularity of granularities) {
    if (granularity !== "segment" && granularity !== "word") return invalid("deAPI timestamp_granularities supports segment and word");
    if (granularity === "word" && !entry.wordTimestamps) return invalid(`deAPI model ${model} does not return word timestamps`);
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
      return invalid("deAPI transcription temperature must be a number from 0 to 1");
    }
    temperature = rawTemperature.trim();
  }

  if (Number.isFinite(file.size) && file.size > DEAPI_MAX_STT_FILE_BYTES) return invalid("deAPI transcription file is too large");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) return invalid("deAPI transcription file is empty");
  if (bytes.length > DEAPI_MAX_STT_FILE_BYTES) return invalid("deAPI transcription file is too large");

  const body = new FormData();
  body.append("model", entry.id);
  if (language.value !== null) body.append("language", language.value);
  if (prompt.value !== null) body.append("prompt", prompt.value);
  if (requested !== null && requested !== "") body.append("response_format", responseFormat);
  if (temperature !== null) body.append("temperature", temperature);
  for (const granularity of granularities) body.append("timestamp_granularities[]", granularity);
  const type = isString(file.type) && file.type && !/[\r\n]/.test(file.type) ? file.type : "application/octet-stream";
  body.append("file", new Blob([bytes], { type }), deapiUploadFileName(file));
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

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.timeoutMs] - deadline for the request and its body
 */
export function createDeapiSttAdapter({ fetchImpl, timeoutMs = DEAPI_STT_TIMEOUT_MS, maxTranscriptBytes = DEAPI_MAX_TRANSCRIPT_BYTES } = {}) {
  return {
    provider: DEAPI_PROVIDER_ID,
    models: DEAPI_STT_MODELS,
    responseFormats: DEAPI_TRANSCRIPTION_RESPONSE_FORMATS,
    /**
     * STT core result contract (sttCore.js): `{ success: true, response,
     * usageValue, nativeUnits, accounting }`, or an error result; `local` marks
     * caller input errors and `acceptedJob` marks a request deAPI may have
     * processed and billed.
     */
    async transcribe({ model, formData, credentials, kind, signal }) {
      const built = await buildDeapiTranscriptionRequest(model, formData, { kind });
      if (!built.body) return built;
      const token = deapiToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable deAPI API key on this connection");
      const sent = await sendOnce(DEAPI_TRANSCRIPTION_URL, {
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
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "deAPI transcription request aborted after it was sent"), MODALITY, "accepted");
          if (sent.timedOut()) return lostResult(MODALITY, LABEL, "transcript did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT);
          return lostResult(MODALITY, LABEL, "transcript was unreadable or too large");
        }
        const accounting = mediaAccounting(null, DEAPI_PROVIDER_ID, MODALITY);
        accounting.meta = { model, responseFormat: built.responseFormat };
        if (!isJson) {
          // Plain text has no usage or duration.
          return {
            success: true,
            response: new Response(text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" } }),
            usageValue: undefined,
            nativeUnits: {},
            accounting,
          };
        }
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          // The parser's message quotes the body, so it is dropped.
        }
        if (!isRecord(data)) return lostResult(MODALITY, LABEL, "returned an unreadable transcript");
        // An error envelope produced no transcript (9router #5864); its text is not quoted.
        if (errorEnvelopeMessage(data)) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "deAPI transcription answered with an error payload");
        if (!isString(data.text)) return lostResult(MODALITY, LABEL, "returned no transcript text");
        if (built.responseFormat === "text") {
          return {
            success: true,
            response: new Response(data.text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" } }),
            ...usageOf(data),
            accounting,
          };
        }
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
