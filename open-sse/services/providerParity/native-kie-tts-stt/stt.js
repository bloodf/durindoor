// Kie native transcription: one createTask carrying the file as base64, a
// bounded recordInfo poll, and the transcript text. Staged for
// /v1/audio/transcriptions and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/audioTranscription.ts handleKieAudioTranscription (submit
// body `{ model, input: { file_name, file_base64 } }`, no callback; file name
// from utils/audioMultipart.ts getUploadedFileName: `.opus` relabelled `.ogg`,
// "audio.wav" when unnamed), pollKieTranscriptionResult (120 s, 2 s interval)
// and normalizeKieTranscriptionText (`data.response.text`, `data.resultText`,
// `data.text`, then `text`; a synchronous answer reads `data.text` then `text`).
//
// Fork deviations: see ./task.js for transport; in addition only
// elevenlabs/speech-to-text (audio isolation is refused, ./config.js says
// why); translations, streaming, timestamp granularities and response formats
// other than json and text are refused before submit; an empty or oversized
// file is refused before submit; a completed task without a text field is an
// unknown outcome instead of an empty transcript; `language`, `prompt` and
// `temperature` are accepted and not forwarded, as in the source.
import { Buffer } from "node:buffer";
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { isFunction, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  KIE_EXCLUDED_MODELS, KIE_MAX_STT_FILE_BYTES, KIE_PROVIDER_ID, KIE_STT_MODELS, KIE_STT_TIMEOUT_MS, kieSttModel,
} from "./config.js";
import { runKieTask } from "./task.js";

const MODALITY = "stt";
export const KIE_TRANSCRIPTION_RESPONSE_FORMATS = Object.freeze(["json", "text"]);
const MAX_FILE_NAME = 255;

// Input errors are the caller's, not the account's.
const invalid = (message) => ({ ...createErrorResult(HTTP_STATUS.BAD_REQUEST, message), local: true });

/** Source getUploadedFileName, with control characters and length bounded. */
export function kieUploadFileName(file) {
  const name = isString(file?.name) ? file.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_FILE_NAME) : "";
  return name ? name.replace(/\.opus$/i, ".ogg") : "audio.wav";
}

const field = (formData, name) => (isFunction(formData?.get) ? formData.get(name) : null);

/**
 * Source normalizeKieTranscriptionText for a polled record, or null when no
 * text field is present (the source answered "").
 */
export function kieTranscriptText(record) {
  const data = isRecord(record?.data) ? record.data : {};
  const response = isRecord(data.response) ? data.response : {};
  return [response.text, data.resultText, data.text, record?.text].find(isString) ?? null;
}

/** Source synchronous answer (no task id): `data.text`, then `text`. */
const syncText = (record) => [isRecord(record?.data) ? record.data.text : undefined, record?.text].find(isString) ?? null;

/**
 * Check a transcription request and build the source's Kie task body.
 *
 * @returns {Promise<{ payload: object, responseFormat: "json" | "text" } | object>} the body, or a 400 error result
 */
export async function buildKieTranscriptionRequest(model, formData, { kind = "transcription" } = {}) {
  if (kind !== "transcription") return invalid("Kie does not support audio translations");
  const excluded = KIE_EXCLUDED_MODELS[model];
  if (excluded) return invalid(`Kie model ${model} is not supported for transcription here: ${excluded.reason}`);
  if (!kieSttModel(model)) return invalid(`Unsupported Kie transcription model: ${model}. Use one of: ${KIE_STT_MODELS.map((m) => m.id).join(", ")}`);
  const file = field(formData, "file");
  if (!file || !isFunction(file.arrayBuffer)) return invalid("Missing required field: file");
  const stream = field(formData, "stream");
  if (stream !== null && String(stream).toLowerCase() !== "false") return invalid("Kie transcription does not support streaming");
  if (field(formData, "timestamp_granularities[]") !== null || field(formData, "timestamp_granularities") !== null) {
    return invalid("Kie transcription does not return timestamps");
  }
  const requested = field(formData, "response_format");
  const responseFormat = requested === null || requested === "" ? "json" : String(requested);
  if (!KIE_TRANSCRIPTION_RESPONSE_FORMATS.includes(responseFormat)) {
    return invalid("Kie transcription supports response_format json or text");
  }
  if (Number.isFinite(file.size) && file.size > KIE_MAX_STT_FILE_BYTES) return invalid("Kie transcription file is too large");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) return invalid("Kie transcription file is empty");
  if (bytes.length > KIE_MAX_STT_FILE_BYTES) return invalid("Kie transcription file is too large");
  return {
    payload: { model, input: { file_name: kieUploadFileName(file), file_base64: bytes.toString("base64") } },
    responseFormat,
  };
}

/**
 * @param {object} [options] - task bounds and clock, for tests; see runKieTask
 */
export function createKieSttAdapter({ timeoutMs = KIE_STT_TIMEOUT_MS, ...polling } = {}) {
  return {
    async: true,
    provider: KIE_PROVIDER_ID,
    models: KIE_STT_MODELS,
    responseFormats: KIE_TRANSCRIPTION_RESPONSE_FORMATS,
    /**
     * STT core result contract (sttCore.js): `{ success: true, response,
     * usageValue, nativeUnits, accounting }`, or an error result; `local` marks
     * caller input errors and `acceptedJob` marks a task that may bill.
     */
    async transcribe({ model, formData, credentials, kind, signal, log }) {
      const built = await buildKieTranscriptionRequest(model, formData, { kind });
      if (!built.payload) return built;
      let synchronous = false;
      const result = await runKieTask({
        ...polling,
        timeoutMs,
        modality: MODALITY,
        label: "transcription",
        payload: built.payload,
        read: (record, { polled }) => {
          synchronous = !polled;
          return polled ? kieTranscriptText(record) : syncText(record);
        },
        credentials,
        signal,
        log,
      });
      if (!result.success) return result;
      const text = result.value;
      // Kie reports no duration or token usage; cost stays unknown.
      const accounting = { ...result.accounting, meta: { ...result.accounting.meta, taskId: result.taskId, synchronous } };
      const response = built.responseFormat === "text"
        ? new Response(text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" } })
        : new Response(JSON.stringify({ text }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
      return { success: true, response, usageValue: undefined, nativeUnits: {}, accounting };
    },
  };
}
