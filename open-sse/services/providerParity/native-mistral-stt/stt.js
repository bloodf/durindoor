// Mistral native transcription: one multipart POST to
// https://api.mistral.ai/v1/audio/transcriptions. Staged for
// /v1/audio/transcriptions and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/audioTranscription.ts handleAudioTranscription, default
// branch (the `mistral` registry entry has no `format`): header
// `Authorization: Bearer <key>` (buildAuthHeaders, authHeader "bearer") and a
// multipart body of `model`, then `language`, `prompt`, `response_format`,
// `temperature` and `timestamp_granularities[]` when present, then `file`
// (open-sse/utils/audioMultipart.ts buildMultipartBody: file name from
// getUploadedFileName, `.opus` relabelled `.ogg`, "audio.wav" when unnamed,
// part type from the upload or application/octet-stream). The answer is passed
// through with its content type.
//
// Vendor contract (wins over the source where they differ), read 2026-11-27:
// https://docs.mistral.ai/openapi.yaml (sha256 acf0efcb...), operationId
// audio_api_v1_transcriptions_post, request schema AudioTranscriptionRequest,
// 200 schema TranscriptionResponse; and mistralai/client-python at
// 6e9e31ac6f982c1fdfe177787ded223f458c9f69 (models/audiotranscriptionrequest.py,
// utils/forms.py serialize_multipart_form). The request schema has no `prompt`
// and no `response_format` field; `language` matches ^\w{2}$; `temperature` is
// an unbounded `number`; `timestamp_granularities` is an array of
// "segment" | "word" that the SDK sends as one repeated multipart field named
// `timestamp_granularities` (no `[]` suffix). The source's
// `timestamp_granularities[]` and `response_format` parts are therefore not sent.
//
// Fork deviations: see ./http.js for transport; in addition only the three
// source models; translations, streaming, a `url` input, response_format other
// than json (accepted and not forwarded: the endpoint answers JSON only),
// timestamp granularities other than segment/word, a language that is not two
// word characters, a temperature outside the gateway's 0 to 1 bound (the
// vendor schema sets no range), a non-empty `prompt`, and a missing, empty or
// oversized file are refused before submit. All client spellings of the
// granularity field are merged under the vendor's `timestamp_granularities`.
// The answer must be a JSON object with a string `text`; anything else,
// including a mislabelled error envelope, is not returned as a transcript.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { createErrorResult, errorEnvelopeMessage } from "../../../utils/error.js";
import { isFunction, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  MISTRAL_MAX_STT_FILE_BYTES, MISTRAL_MAX_TRANSCRIPT_BYTES, MISTRAL_PROVIDER_ID, MISTRAL_STT_MODELS,
  MISTRAL_STT_TIMEOUT_MS, MISTRAL_TRANSCRIPTION_URL, mistralSttModel,
} from "./config.js";
import { discard, invalid, lostResult, mistralToken, sendOnce, withAcceptedJob } from "./http.js";

export const MISTRAL_TRANSCRIPTION_RESPONSE_FORMATS = Object.freeze(["json"]);
const GRANULARITY_FIELDS = Object.freeze(["timestamp_granularities[]", "timestamp_granularities"]);
/** Vendor multipart name: a repeated field, no `[]` (client-python serialize_multipart_form). */
export const MISTRAL_GRANULARITY_WIRE_FIELD = "timestamp_granularities";
/** AudioTranscriptionRequest.language pattern in the vendor OpenAPI document. */
const LANGUAGE_PATTERN = /^\w{2}$/;
const GRANULARITIES = new Set(["segment", "word"]);
const MAX_TEXT_FIELD = 4096;

const field = (formData, name) => (isFunction(formData?.get) ? formData.get(name) : null);
const fields = (formData, name) => (isFunction(formData?.getAll) ? formData.getAll(name) : []);

/** Source getUploadedFileName plus buildMultipartBody's quote and line-break scrub. */
export function mistralUploadFileName(file) {
  const raw = isString(file?.name) && file.name.length > 0 ? file.name : "";
  const name = raw ? raw.replace(/\.opus$/i, ".ogg") : "audio.wav";
  return name.replace(/["]/g, "_").replace(/[\r\n]/g, "_");
}

function optionalText(formData, name) {
  const value = field(formData, name);
  if (value === null || value === "") return { value: null };
  if (!isString(value)) return { error: `Mistral transcription ${name} must be text` };
  if (value.length > MAX_TEXT_FIELD) return { error: `Mistral transcription ${name} is too long` };
  return { value };
}

/**
 * Check a transcription request and build the source's multipart body.
 *
 * @returns {Promise<{ body: FormData } | object>} the body, or a 400 error result with `local: true`
 */
export async function buildMistralTranscriptionRequest(model, formData, { kind = "transcription" } = {}) {
  if (kind !== "transcription") return invalid("Mistral audio translations are not supported");
  const entry = mistralSttModel(model);
  if (!entry) return invalid(`Unsupported Mistral transcription model: ${model}. Use one of: ${MISTRAL_STT_MODELS.map((m) => m.id).join(", ")}`);
  const file = field(formData, "file");
  if (!file || !isFunction(file.arrayBuffer)) {
    return invalid(field(formData, "url") !== null ? "Mistral transcription takes an uploaded file, not a url" : "Missing required field: file");
  }
  const stream = field(formData, "stream");
  if (stream !== null && String(stream).toLowerCase() !== "false") return invalid("Mistral transcription does not support streaming");

  const requested = field(formData, "response_format");
  const named = requested !== null && requested !== "";
  if (named && String(requested).trim().toLowerCase() !== "json") {
    return invalid(`Mistral transcription supports response_format ${MISTRAL_TRANSCRIPTION_RESPONSE_FORMATS.join(", ")}`);
  }

  const granularities = [...new Set(GRANULARITY_FIELDS.flatMap((name) => fields(formData, name))
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean))];
  if (granularities.some((value) => !GRANULARITIES.has(value))) return invalid("Mistral timestamp_granularities supports segment and word");

  const language = optionalText(formData, "language");
  if (language.error) return invalid(language.error);
  if (language.value !== null && !LANGUAGE_PATTERN.test(language.value)) return invalid("Mistral transcription language must be a two-letter code such as en");
  const prompt = optionalText(formData, "prompt");
  if (prompt.error) return invalid(prompt.error);
  if (prompt.value !== null) return invalid("Mistral transcription does not accept a prompt");

  const rawTemperature = field(formData, "temperature");
  let temperature = null;
  if (rawTemperature !== null && rawTemperature !== "") {
    const number = Number(rawTemperature);
    if (!isString(rawTemperature) || !rawTemperature.trim() || !Number.isFinite(number) || number < 0 || number > 1) {
      // Gateway bound; the vendor schema declares an unbounded number.
    return invalid("Mistral transcription temperature must be a number from 0 to 1");
    }
    temperature = rawTemperature.trim();
  }

  if (Number.isFinite(file.size) && file.size > MISTRAL_MAX_STT_FILE_BYTES) return invalid("Mistral transcription file is too large");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) return invalid("Mistral transcription file is empty");
  if (bytes.length > MISTRAL_MAX_STT_FILE_BYTES) return invalid("Mistral transcription file is too large");
  const type = isString(file.type) && file.type && !/[\r\n]/.test(file.type) ? file.type : "application/octet-stream";

  // Source field order: model, the optional fields, then the file. Only
  // fields the vendor AudioTranscriptionRequest schema declares are sent.
  const body = new FormData();
  body.append("model", entry.id);
  if (language.value !== null) body.append("language", language.value);
  if (temperature !== null) body.append("temperature", temperature);
  for (const granularity of granularities) body.append(MISTRAL_GRANULARITY_WIRE_FIELD, granularity);
  body.append("file", new Blob([bytes], { type }), mistralUploadFileName(file));
  return { body };
}

/** Provider usage and audio seconds, kept only when well formed. Cost is never read as USD. */
function usageOf(data) {
  const usage = isRecord(data.usage) ? data.usage : null;
  const seconds = usage?.prompt_audio_seconds ?? data.duration;
  return {
    usageValue: usage ? { usage } : undefined,
    nativeUnits: isNumber(seconds) && Number.isFinite(seconds) && seconds >= 0 ? { audioSeconds: seconds } : {},
  };
}

const isErrorPayload = (data) => data.object === "error" || Boolean(errorEnvelopeMessage(data));

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.timeoutMs] - deadline for the request and its body
 * @param {number} [options.maxTranscriptBytes] - cap on the answer body
 */
export function createMistralSttAdapter({ fetchImpl, timeoutMs = MISTRAL_STT_TIMEOUT_MS, maxTranscriptBytes = MISTRAL_MAX_TRANSCRIPT_BYTES } = {}) {
  return {
    provider: MISTRAL_PROVIDER_ID,
    models: MISTRAL_STT_MODELS,
    responseFormats: MISTRAL_TRANSCRIPTION_RESPONSE_FORMATS,
    /**
     * STT core result contract (sttCore.js): `{ success: true, response,
     * usageValue, nativeUnits, accounting }`, or an error result; `local` marks
     * caller input errors and `acceptedJob` marks a request Mistral may have
     * processed and billed.
     */
    async transcribe({ model, formData, credentials, kind, signal }) {
      const built = await buildMistralTranscriptionRequest(model, formData, { kind });
      if (!built.body) return built;
      const token = mistralToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable Mistral API key on this connection");
      // No Content-Type: fetch derives the multipart boundary from the FormData.
      const sent = await sendOnce(MISTRAL_TRANSCRIPTION_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: built.body,
      }, { credentials, signal, timeoutMs, fetchImpl });
      if (sent.failure) return sent.failure;
      const { response, fetchSignal } = sent;
      try {
        const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!/(^application\/json$|\+json$)/.test(contentType)) {
          discard(response);
          return lostResult("answered without a JSON transcript");
        }
        let text;
        try {
          text = (await readBounded(response.body, maxTranscriptBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY)).toString("utf8");
        } catch {
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Mistral transcription request aborted after it was sent"), "accepted");
          if (sent.timedOut()) return lostResult("transcript did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT);
          return lostResult("transcript was unreadable or too large");
        }
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          // The parser's message quotes the body, so it is dropped.
        }
        if (!isRecord(data)) return lostResult("returned an unreadable transcript");
        // An error envelope produced no transcript; its text is not quoted.
        if (isErrorPayload(data)) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Mistral transcription answered with an error payload");
        if (!isString(data.text)) return lostResult("returned no transcript text");
        const accounting = mediaAccounting(null, MISTRAL_PROVIDER_ID, "stt");
        accounting.meta = { model, responseFormat: "json" };
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
