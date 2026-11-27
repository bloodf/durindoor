// Gladia native asynchronous transcription: upload the audio, submit a
// pre-recorded job, then poll its result_url, all on https://api.gladia.io.
// Staged for /v1/audio/transcriptions and not registered (see
// ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/audioTranscription.ts handleGladiaTranscription
// (1. multipart `POST https://api.gladia.io/v2/upload` with the single part
// `audio` and `x-gladia-key: <key>`, answer `{ audio_url }`; 2. JSON
// `POST https://api.gladia.io/v2/pre-recorded` with `{ audio_url, model }`,
// answer `{ result_url }`, refused unless it is on the API origin; 3. wait
// 2 s, then `GET result_url` (15 s per call, redirects refused, public
// addresses only) for up to 120 s until `status` is "done" or "error"; a
// non-2xx poll is skipped; 4. the answer is `{ text }` from
// `result.transcription.full_transcript`), pollGladiaResultOnce and
// open-sse/utils/audioMultipart.ts (getUploadedFileName: `.opus` relabelled
// `.ogg`, "audio.wav" when unnamed; `"` and CR/LF replaced by `_`).
//
// Fork deviations: see ./http.js for transport; in addition one total
// deadline and a per-call ceiling; the poll URL is rebuilt from the fixed
// origin and the job id after the returned result_url is checked to be
// exactly `https://api.gladia.io/v2/pre-recorded/<id>`, so no address taken
// from an answer is ever fetched; translations, streaming, a `url` input,
// every response format except json and text, and request fields the source
// drops (language, prompt, a non-zero temperature, timestamp granularities,
// diarization) are refused before anything is uploaded, as are a missing,
// empty or oversized file; `text` output is returned as text/plain (the
// source answered JSON for every format); the upload and the submit are never
// retried or replayed; a poll continues past 408/425/429/5xx and transport
// errors only inside the deadline and stops at any other refusal; a failed
// job, a refused or redirected poll, an unsafe job id and a malformed result
// never quote Gladia's text; uploads and jobs are left on the account, as in
// the source.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { createErrorResult } from "../../../utils/error.js";
import { isFunction, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  GLADIA_API_ORIGIN, GLADIA_AUTH_HEADER, GLADIA_MAX_AUDIO_URL_LENGTH, GLADIA_MAX_RESULT_BYTES, GLADIA_MAX_STT_FILE_BYTES,
  GLADIA_POLL_CALL_TIMEOUT_MS, GLADIA_POLL_INTERVAL_MS, GLADIA_POLL_WINDOW_MS, GLADIA_PRE_RECORDED_URL, GLADIA_PROVIDER_ID,
  GLADIA_STT_CALL_TIMEOUT_MS, GLADIA_STT_MODELS, GLADIA_STT_TOTAL_TIMEOUT_MS, GLADIA_UPLOAD_URL, gladiaSttModel,
} from "./config.js";
import {
  boundedSend, discard, gladiaSecrets, gladiaToken, invalid, lostResult, readJsonObject, redirected, refusedAnswer, sendOnce,
  withAcceptedJob,
} from "./http.js";

const MODALITY = "stt";
const LABEL = "transcription";
/** Response formats this adapter returns. */
export const GLADIA_TRANSCRIPTION_RESPONSE_FORMATS = Object.freeze(["json", "text"]);
/**
 * Request fields the source accepts but never sends to Gladia. Refused when
 * set so the gateway does not claim an option it ignores.
 */
export const GLADIA_DROPPED_FIELDS = Object.freeze([
  "language", "prompt", "timestamp_granularities[]", "timestamp_granularities",
  "enable_speaker_diarization", "diarization", "speaker_labels", "diarize",
]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const RESULT_PATH = /^\/v2\/pre-recorded\/([A-Za-z0-9_-]{1,128})$/;
const MAX_FILE_NAME = 255;
const PENDING_STATES = new Set(["queued", "processing"]);
const TRANSIENT_POLL = new Set([408, 425, 429, 500, 502, 503, 504]);
const CORS = { "Access-Control-Allow-Origin": "*" };

const field = (formData, name) => (isFunction(formData?.get) ? formData.get(name) : null);
const fields = (formData, name) => (isFunction(formData?.getAll) ? formData.getAll(name) : []);

/** Source getUploadedFileName plus buildMultipartBody's quote and CR/LF replacement. */
export function gladiaUploadFileName(file) {
  const raw = isString(file?.name) ? file.name.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, MAX_FILE_NAME) : "";
  const name = raw ? raw.replace(/\.opus$/i, ".ogg") : "audio.wav";
  return name.replace(/["]/g, "_").replace(/[\r\n]/g, "_");
}

/**
 * Check a transcription request and build the upload body. Nothing is sent here.
 *
 * @returns {Promise<object>} `{ upload: FormData, model, responseFormat }`, or a 400 error result with `local: true`
 */
export async function buildGladiaTranscriptionRequest(model, formData, { kind = "transcription" } = {}) {
  if (kind !== "transcription") return invalid("Gladia audio translations are not supported here");
  const entry = gladiaSttModel(model);
  if (!entry) return invalid(`Unsupported Gladia transcription model: ${model}. Use one of: ${GLADIA_STT_MODELS.map((m) => m.id).join(", ")}`);
  const file = field(formData, "file");
  if (!file || !isFunction(file.arrayBuffer)) {
    return invalid(field(formData, "url") !== null ? "Gladia transcription takes an uploaded file, not a url" : "Missing required field: file");
  }
  const stream = field(formData, "stream");
  if (stream !== null && String(stream).toLowerCase() !== "false") return invalid("Gladia transcription does not support streaming here");
  const temperature = field(formData, "temperature");
  if (temperature !== null && temperature !== "" && Number(temperature) !== 0) return invalid("Gladia transcription does not support temperature");
  for (const name of GLADIA_DROPPED_FIELDS) {
    if (fields(formData, name).some((value) => !isString(value) || value.trim() !== "")) {
      return invalid(`Gladia transcription does not support ${name.replace("[]", "")} here`);
    }
  }

  const requested = field(formData, "response_format");
  if (requested !== null && !isString(requested)) return invalid("Gladia transcription response_format must be text");
  const responseFormat = requested ? requested.trim().toLowerCase() : "json";
  if (!GLADIA_TRANSCRIPTION_RESPONSE_FORMATS.includes(responseFormat)) {
    return invalid(`Gladia transcription supports response_format ${GLADIA_TRANSCRIPTION_RESPONSE_FORMATS.join(", ")}`);
  }

  if (Number.isFinite(file.size) && file.size > GLADIA_MAX_STT_FILE_BYTES) return invalid("Gladia transcription file is too large");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) return invalid("Gladia transcription file is empty");
  if (bytes.length > GLADIA_MAX_STT_FILE_BYTES) return invalid("Gladia transcription file is too large");

  // Gladia reads the file from the `audio` part (source comment: any other name is a 400).
  const upload = new FormData();
  const type = isString(file.type) && file.type && !/[\r\n]/.test(file.type) ? file.type : "application/octet-stream";
  upload.append("audio", new Blob([bytes], { type }), gladiaUploadFileName(file));
  return { upload, model: entry.id, responseFormat };
}

/** The upload answer's audio_url, or null when it is not a plain https URL. It is only sent back to Gladia, never fetched. */
export function gladiaAudioUrl(record) {
  const value = record?.audio_url;
  if (!isString(value) || !value || value.length > GLADIA_MAX_AUDIO_URL_LENGTH || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
}

/** The source submit body, in source key order. */
export const gladiaJobBody = (audioUrl, model) => ({ audio_url: audioUrl, model });

/**
 * The job a submit answer names, or null. `result_url` must be exactly
 * `https://api.gladia.io/v2/pre-recorded/<id>` (and agree with `id` when one
 * is given); the poll URL is rebuilt from the fixed origin, never taken from
 * the answer.
 */
export function gladiaResultJob(record) {
  if (!isRecord(record) || !isString(record.result_url)) return null;
  let url;
  try {
    url = new URL(record.result_url);
  } catch {
    return null;
  }
  if (url.origin !== GLADIA_API_ORIGIN || url.username || url.password || url.search || url.hash) return null;
  const match = RESULT_PATH.exec(url.pathname);
  if (!match) return null;
  if (record.id !== undefined && record.id !== match[1]) return null;
  return { jobId: match[1], pollUrl: `${GLADIA_PRE_RECORDED_URL}/${match[1]}` };
}

/** The source's client text from a finished poll answer, or null when the result is unusable. */
export function gladiaTranscriptText(record) {
  const transcription = isRecord(record?.result) ? record.result.transcription : null;
  return isRecord(transcription) && isString(transcription.full_transcript) ? transcription.full_transcript : null;
}

const remaining = (deadline, now) => deadline - now();

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.totalTimeoutMs] - one deadline for upload, submit and polling
 * @param {number} [options.callTimeoutMs] - ceiling for the upload and the submit
 * @param {number} [options.pollCallTimeoutMs] - ceiling for each poll
 * @param {number} [options.pollWindowMs] - source polling window after the submit
 * @param {number} [options.pollIntervalMs]
 * @param {number} [options.maxResultBytes]
 * @param {Function} [options.wait] - `(ms, signal)` sleep; tests inject a fast one
 * @param {Function} [options.now]
 */
export function createGladiaSttAdapter({
  fetchImpl,
  totalTimeoutMs = GLADIA_STT_TOTAL_TIMEOUT_MS,
  callTimeoutMs = GLADIA_STT_CALL_TIMEOUT_MS,
  pollCallTimeoutMs = GLADIA_POLL_CALL_TIMEOUT_MS,
  pollWindowMs = GLADIA_POLL_WINDOW_MS,
  pollIntervalMs = GLADIA_POLL_INTERVAL_MS,
  maxResultBytes = GLADIA_MAX_RESULT_BYTES,
  wait = sleep,
  now = Date.now,
} = {}) {
  /**
   * Poll one accepted job until it settles. Never re-submits the job.
   * @returns {Promise<{ text: string } | { failure: object }>}
   */
  async function awaitJob({ jobId, pollUrl }, { headers, credentials, signal, deadline }) {
    const aborted = () => ({ failure: withAcceptedJob(createErrorResult(499, "Gladia transcription aborted while the job was running"), MODALITY, "accepted", jobId) });
    const unknown = (message, status = HTTP_STATUS.BAD_GATEWAY, jobState = "poll-failed") =>
      ({ failure: lostResult(MODALITY, LABEL, message, status, jobState, jobId) });
    for (;;) {
      const left = remaining(deadline, now);
      if (left <= 0) return unknown("did not finish in time; the job may still complete and bill", HTTP_STATUS.GATEWAY_TIMEOUT, "poll-timeout");
      try {
        await wait(Math.min(pollIntervalMs, left), signal);
      } catch {
        return aborted();
      }
      if (signal?.aborted) return aborted();
      const budget = Math.min(pollCallTimeoutMs, remaining(deadline, now));
      if (budget <= 0) continue;
      let sent;
      try {
        sent = await boundedSend(pollUrl, { method: "GET", headers }, { fetchImpl, credentials, signal, timeoutMs: budget });
      } catch {
        if (signal?.aborted) return aborted();
        continue; // a result read is safe to repeat inside the deadline
      }
      const { response, fetchSignal } = sent;
      try {
        if (redirected(response)) return unknown("result_url answered with a redirect; the redirect was not followed");
        if (!response.ok) {
          if (TRANSIENT_POLL.has(response.status)) {
            discard(response);
            continue;
          }
          const refused = await refusedAnswer(response, { signal, modality: MODALITY, label: `${LABEL} result`, secrets: gladiaSecrets(credentials), billable: false });
          return { failure: withAcceptedJob(refused, MODALITY, "poll-failed", jobId) };
        }
        const record = await readJsonObject(response, { signal: fetchSignal, maxBytes: maxResultBytes, timeoutMs: Math.max(1, budget) });
        if (signal?.aborted) return aborted();
        if (!record || !isString(record.status)) return unknown("result_url returned an unreadable answer");
        const state = record.status.toLowerCase();
        if (state === "done") {
          const text = gladiaTranscriptText(record);
          return text === null ? unknown("finished with an unreadable transcript", HTTP_STATUS.BAD_GATEWAY, "accepted") : { text };
        }
        if (state === "error") {
          // A failed job produced no transcript; Gladia's text is not quoted, only a numeric code.
          const code = Number.isInteger(record.error_code) && record.error_code >= 400 && record.error_code < 600 ? ` (code ${record.error_code})` : "";
          return { failure: createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Gladia transcription job failed${code}`) };
        }
        if (!PENDING_STATES.has(state)) return unknown("result_url returned an unknown job state");
      } finally {
        sent.clear();
      }
    }
  }

  return {
    provider: GLADIA_PROVIDER_ID,
    models: GLADIA_STT_MODELS,
    responseFormats: GLADIA_TRANSCRIPTION_RESPONSE_FORMATS,
    /**
     * STT core result contract (sttCore.js): `{ success: true, response,
     * usageValue, nativeUnits, accounting }`, or an error result; `local` marks
     * caller input errors and `acceptedJob` marks a job Gladia may have
     * processed and billed.
     */
    async transcribe({ model, formData, credentials, kind, signal }) {
      const built = await buildGladiaTranscriptionRequest(model, formData, { kind });
      if (!built.upload) return built;
      const token = gladiaToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable Gladia API key on this connection");
      const auth = { [GLADIA_AUTH_HEADER]: token };
      const deadline = now() + totalTimeoutMs;
      const budget = () => Math.min(callTimeoutMs, remaining(deadline, now));
      const context = { credentials, signal, fetchImpl };

      // 1. Upload. Stores audio but bills nothing, so an unknown outcome carries no acceptedJob.
      const uploaded = await sendOnce(GLADIA_UPLOAD_URL, { method: "POST", headers: { ...auth }, body: built.upload },
        { ...context, modality: MODALITY, label: "audio upload", timeoutMs: budget(), billable: false });
      if (uploaded.failure) return uploaded.failure;
      let uploadRecord;
      try {
        uploadRecord = await readJsonObject(uploaded.response, { signal: uploaded.fetchSignal, timeoutMs: Math.max(1, budget()) });
      } finally {
        uploaded.clear();
      }
      if (signal?.aborted) return { ...createErrorResult(499, "Gladia transcription aborted before the job was submitted"), local: true };
      const audioUrl = gladiaAudioUrl(uploadRecord);
      if (!audioUrl) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Gladia audio upload returned no usable audio_url");
      if (budget() <= 0) return createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, "Gladia transcription ran out of time before the job was submitted");

      // 2. Submit the pre-recorded job: billable, sent once, never replayed.
      const submitted = await sendOnce(GLADIA_PRE_RECORDED_URL, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(gladiaJobBody(audioUrl, built.model)),
      }, { ...context, modality: MODALITY, label: LABEL, timeoutMs: budget(), billable: true });
      if (submitted.failure) return submitted.failure;
      let jobRecord;
      try {
        jobRecord = await readJsonObject(submitted.response, { signal: submitted.fetchSignal, timeoutMs: Math.max(1, budget()) });
      } finally {
        submitted.clear();
      }
      const job = gladiaResultJob(jobRecord);
      if (!job) {
        const knownId = isString(jobRecord?.id) && SAFE_ID.test(jobRecord.id) ? jobRecord.id : null;
        return lostResult(MODALITY, LABEL, "job was accepted without a usable result_url on the API origin", HTTP_STATUS.BAD_GATEWAY, "accepted", knownId);
      }
      if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Gladia transcription aborted after the job was submitted"), MODALITY, "accepted", job.jobId);

      // 3. Poll inside the source window and the total deadline.
      const settled = await awaitJob(job, { headers: auth, credentials, signal, deadline: Math.min(deadline, now() + pollWindowMs) });
      if (settled.failure) return settled.failure;

      const accounting = mediaAccounting(null, GLADIA_PROVIDER_ID, MODALITY);
      accounting.meta = { model: built.model, responseFormat: built.responseFormat, jobId: job.jobId };
      accounting.nativeUnits = {};
      const response = built.responseFormat === "text"
        ? new Response(settled.text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } })
        : new Response(JSON.stringify({ text: settled.text }), { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
      return { success: true, response, usageValue: undefined, nativeUnits: {}, accounting };
    },
  };
}
