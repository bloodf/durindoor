// Grok CLI native transcription: one multipart POST to
// https://api.x.ai/v1/stt with the Grok Build OAuth token. Staged for
// /v1/audio/transcriptions and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/grokMedia.ts handleGrokTranscription (headers from
// grokMediaHeaders plus the multipart content type; fields `model`, then the
// string values of language, diarize, multichannel, channels, sample_rate,
// audio_format, format and filler_words in that order, then `file` last,
// named per open-sse/utils/audioMultipart.ts getUploadedFileName with `.opus`
// relabelled `.ogg` and "audio.wav" when unnamed; `response_format` json,
// verbose_json or text is not forwarded; the answer must carry a string
// `text`; text returns it as text/plain, json formats pass the native object
// through), selected by the `grok-stt` branch of
// open-sse/handlers/audioTranscription.ts.
//
// Fork deviations: see ./http.js for transport; in addition only the source
// model; translations, streaming, fields the source would silently drop
// (prompt, temperature, timestamp_granularities, include and any other
// unknown field), boolean options other than true/false, channels and
// sample_rate that are not positive integers, other option values that are
// not short tokens, and a missing, empty or oversized file are refused before
// submit. A JSON answer must be an object with a string `text`, read within
// the deadline and a size bound.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult, errorEnvelopeMessage } from "../../../utils/error.js";
import { isFunction, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  GROK_CLI_PROVIDER_ID, GROK_MAX_STT_FILE_BYTES, GROK_MAX_TRANSCRIPT_BYTES, GROK_STT_MODELS, GROK_STT_OPTION_FIELDS,
  GROK_STT_TIMEOUT_MS, GROK_TRANSCRIPTION_RESPONSE_FORMATS, GROK_TRANSCRIPTION_URL, grokSttModel, grokVoiceHeaders,
} from "./config.js";
import { discard, grokOAuthToken, invalid, lostResult, sendOnce, withAcceptedJob } from "./http.js";

const MODALITY = "stt";
const LABEL = "transcription";
const BOOLEAN_FIELDS = new Set(["diarize", "multichannel", "filler_words"]);
const INTEGER_FIELDS = new Set(["channels", "sample_rate"]);
const TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;
const ACCEPTED_FIELDS = new Set(["file", "model", "response_format", "stream", ...GROK_STT_OPTION_FIELDS]);

/** Source getUploadedFileName: `.opus` is Ogg Opus, so it is relabelled `.ogg`; unnamed is "audio.wav". */
export function grokUploadFileName(file) {
  const name = isString(file?.name) && file.name.length > 0 ? file.name.replace(/\.opus$/i, ".ogg") : "audio.wav";
  return name.replace(/["]/g, "_").replace(/[\r\n]/g, "_");
}

/**
 * Check a transcription request and build the source's multipart body.
 *
 * @returns {Promise<{ body: FormData, responseFormat: string } | object>} the body, or a 400 error result with `local: true`
 */
export async function buildGrokTranscriptionRequest(model, formData, { kind = "transcription" } = {}) {
  if (kind !== "transcription") return invalid("Grok CLI audio translations are not supported");
  const entry = grokSttModel(model);
  if (!entry) return invalid(`Unsupported Grok CLI transcription model: ${model}. Use one of: ${GROK_STT_MODELS.map((m) => m.id).join(", ")}`);
  if (!isFunction(formData?.get) || !isFunction(formData?.keys)) return invalid("Grok transcription needs multipart form data");
  for (const key of formData.keys()) {
    if (!ACCEPTED_FIELDS.has(key)) return invalid(`Grok transcription does not support ${key}`);
  }
  const file = formData.get("file");
  if (!file || !isFunction(file.arrayBuffer)) return invalid("Missing required field: file");
  const stream = formData.get("stream");
  if (stream !== null && String(stream).toLowerCase() !== "false") return invalid("Grok transcription does not support streaming");

  const requested = formData.get("response_format");
  const responseFormat = requested === null || requested === "" ? "json" : String(requested);
  if (!GROK_TRANSCRIPTION_RESPONSE_FORMATS.includes(responseFormat)) {
    return invalid(`Grok transcription supports response_format ${GROK_TRANSCRIPTION_RESPONSE_FORMATS.join(", ")}`);
  }

  const options = [];
  for (const name of GROK_STT_OPTION_FIELDS) {
    const values = formData.getAll(name);
    if (values.length === 0 || (values.length === 1 && values[0] === "")) continue;
    if (values.length > 1) return invalid(`Grok transcription ${name} is named more than once`);
    const value = values[0];
    if (!isString(value)) return invalid(`Grok transcription ${name} must be text`);
    if (BOOLEAN_FIELDS.has(name) && value !== "true" && value !== "false") return invalid(`Grok transcription ${name} must be true or false`);
    if (INTEGER_FIELDS.has(name) && !/^[1-9][0-9]{0,6}$/.test(value)) return invalid(`Grok transcription ${name} must be a positive integer`);
    if (!TOKEN.test(value)) return invalid(`Grok transcription ${name} is not valid`);
    options.push([name, value]);
  }

  if (Number.isFinite(file.size) && file.size > GROK_MAX_STT_FILE_BYTES) return invalid("Grok transcription file is too large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) return invalid("Grok transcription file is empty");
  if (bytes.length > GROK_MAX_STT_FILE_BYTES) return invalid("Grok transcription file is too large");

  const body = new FormData();
  body.append("model", entry.id);
  for (const [name, value] of options) body.append(name, value);
  body.append("file", new Blob([bytes], { type: isString(file.type) && file.type ? file.type : "application/octet-stream" }), grokUploadFileName(file));
  return { body, responseFormat };
}

/** Native duration in seconds, kept only when well formed. No usage object is read as cost. */
function usageOf(data) {
  const usage = isRecord(data.usage) ? data.usage : null;
  const duration = data.duration;
  return {
    usageValue: usage ? { usage } : undefined,
    nativeUnits: isNumber(duration) && Number.isFinite(duration) && duration >= 0 ? { audioSeconds: duration } : {},
  };
}

const cors = { "Access-Control-Allow-Origin": "*" };

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.timeoutMs] - deadline for the request and its body
 * @param {number} [options.maxTranscriptBytes] - cap on the answer body
 */
export function createGrokCliSttAdapter({ fetchImpl, timeoutMs = GROK_STT_TIMEOUT_MS, maxTranscriptBytes = GROK_MAX_TRANSCRIPT_BYTES } = {}) {
  return {
    provider: GROK_CLI_PROVIDER_ID,
    models: GROK_STT_MODELS,
    responseFormats: GROK_TRANSCRIPTION_RESPONSE_FORMATS,
    /**
     * STT core result contract (sttCore.js): `{ success: true, response,
     * usageValue, nativeUnits, accounting }`, or an error result; `local` marks
     * caller input errors and `acceptedJob` marks a request xAI may have
     * processed and billed.
     */
    async transcribe({ model, formData, credentials, kind, signal }) {
      const built = await buildGrokTranscriptionRequest(model, formData, { kind });
      if (!built.body) return built;
      const auth = grokOAuthToken(credentials);
      if (auth.failure) return auth.failure;
      const sent = await sendOnce(GROK_TRANSCRIPTION_URL, {
        method: "POST",
        // fetch sets the multipart Content-Type with its boundary from the FormData body.
        headers: grokVoiceHeaders(auth.token),
        body: built.body,
      }, { modality: MODALITY, label: LABEL, credentials, signal, timeoutMs, fetchImpl });
      if (sent.failure) return sent.failure;
      const { response, fetchSignal } = sent;
      try {
        const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!/(^application\/json$|\+json$)/.test(contentType)) {
          discard(response);
          return lostResult(MODALITY, LABEL, "answered without a JSON transcript");
        }
        let text;
        try {
          text = (await readBounded(response.body, maxTranscriptBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY)).toString("utf8");
        } catch {
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Grok CLI transcription request aborted after it was sent"), MODALITY, "accepted");
          if (sent.timedOut()) return lostResult(MODALITY, LABEL, "transcript did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT);
          return lostResult(MODALITY, LABEL, "transcript was unreadable or too large");
        }
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          // The parser's message quotes the body, so it is dropped.
        }
        if (!isRecord(data) || Array.isArray(data)) return lostResult(MODALITY, LABEL, "returned an unreadable transcript");
        // An error envelope produced no transcript; its text is not quoted.
        if (errorEnvelopeMessage(data)) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Grok CLI transcription answered with an error payload");
        if (!isString(data.text)) return lostResult(MODALITY, LABEL, "returned no transcript text");
        const accounting = mediaAccounting(null, GROK_CLI_PROVIDER_ID, MODALITY);
        accounting.meta = { model, responseFormat: built.responseFormat, authMode: "oauth" };
        if (built.responseFormat === "text") {
          return {
            success: true,
            response: new Response(data.text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...cors } }),
            ...usageOf(data),
            accounting,
          };
        }
        return {
          success: true,
          response: new Response(text, { status: 200, headers: { "Content-Type": "application/json", ...cors } }),
          ...usageOf(data),
          accounting,
        };
      } finally {
        sent.clear();
      }
    },
  };
}
