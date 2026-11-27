// Speechmatics native batch transcription: submit one multipart job, poll it,
// then read the plain-text transcript, all on https://asr.api.speechmatics.com.
// Staged for /v1/audio/transcriptions and not registered (see
// ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/audioTranscription.ts handleSpeechmaticsTranscription
// (1. multipart `POST /v2/jobs` with the part `config` = JSON
// `{ type: "transcription", transcription_config: { language,
// operating_point } }` followed by the audio part `data_file`, and
// `Authorization: Bearer <key>`; language is the trimmed `language` field or
// "auto"; operating_point is the model id; answer `{ id }`, a missing id is a
// 502), pollSpeechmaticsJob (2. `GET /v2/jobs/{id}` every 2 s for up to 120 s
// until `job.status` is "done" or "rejected"; a rejected job is an error),
// fetchSpeechmaticsTranscript (3. `GET /v2/jobs/{id}/transcript?format=txt`
// with `Accept: text/plain`; the client gets `{ text }`),
// open-sse/utils/audioMultipart.ts (getUploadedFileName: `.opus` relabelled
// `.ogg`, "audio.wav" when unnamed; `"` and CR/LF replaced by `_`) and
// open-sse/config/audioRegistry.ts (`speechmatics` row: model "enhanced").
//
// Fork deviations: see ./http.js for transport; in addition one total
// deadline and a per-call ceiling; translations, streaming, a `url` input,
// verbose_json/srt/vtt and unknown response formats, `prompt`, a non-zero
// `temperature`, timestamp granularities, diarization flags, a malformed
// language, and a missing, empty or oversized file are refused before
// anything is submitted (the source ignored the fields it did not use);
// `response_format=text` is returned as text/plain (the source answered
// `{ text }` for every format); the submission is never retried or replayed;
// status checks continue past 429/5xx/transport errors only inside the
// deadline; "deleted" and "expired" jobs are terminal failures; a rejected
// job, a refused or redirected status check, an unsafe job id and a
// malformed transcript never quote Speechmatics' text; jobs are left on the
// account, as in the source.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { createErrorResult } from "../../../utils/error.js";
import { isFunction, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  SPEECHMATICS_AUTO_LANGUAGE, SPEECHMATICS_JOBS_URL, SPEECHMATICS_MAX_STT_FILE_BYTES, SPEECHMATICS_MAX_TRANSCRIPT_BYTES,
  SPEECHMATICS_POLL_INTERVAL_MS, SPEECHMATICS_PROVIDER_ID, SPEECHMATICS_STT_CALL_TIMEOUT_MS, SPEECHMATICS_STT_MODELS,
  SPEECHMATICS_STT_TOTAL_TIMEOUT_MS, speechmaticsSttModel,
} from "./config.js";
import {
  boundedSend, discard, invalid, lostResult, readJsonObject, redirected, refusedAnswer, sendOnce, speechmaticsSecrets,
  speechmaticsToken, withAcceptedJob,
} from "./http.js";

const MODALITY = "stt";
const LABEL = "transcription";
/** Response formats this adapter returns. */
export const SPEECHMATICS_TRANSCRIPTION_RESPONSE_FORMATS = Object.freeze(["json", "text"]);
/** Fields the source ignored and this adapter refuses instead of silently dropping. */
export const SPEECHMATICS_UNSUPPORTED_FIELDS = Object.freeze([
  "timestamp_granularities[]", "timestamp_granularities", "enable_speaker_diarization", "diarization", "speaker_labels", "diarize",
]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/;
const MAX_FILE_NAME = 255;
const PENDING_STATES = new Set(["running", "queued", "pending"]);
const FAILED_STATES = new Set(["rejected", "deleted", "expired"]);
const TRANSIENT_POLL = new Set([408, 425, 429, 500, 502, 503, 504]);
const CORS = { "Access-Control-Allow-Origin": "*" };

const field = (formData, name) => (isFunction(formData?.get) ? formData.get(name) : null);
const present = (value) => value !== null && value !== undefined && value !== "";

/** Source getUploadedFileName plus buildMultipartBody's quote and CR/LF replacement. */
export function speechmaticsUploadFileName(file) {
  const raw = isString(file?.name) ? file.name.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, MAX_FILE_NAME) : "";
  const name = raw ? raw.replace(/\.opus$/i, ".ogg") : "audio.wav";
  return name.replace(/["]/g, "_").replace(/[\r\n]/g, "_");
}

/** Source job config, in source key order. */
export function speechmaticsJobConfig(operatingPoint, language = SPEECHMATICS_AUTO_LANGUAGE) {
  return { type: "transcription", transcription_config: { language, operating_point: operatingPoint } };
}

/**
 * Check a transcription request and build the job submission body. Nothing is
 * sent here.
 *
 * @returns {Promise<object>} `{ submission: FormData, config: object, responseFormat }`, or a 400 error result with `local: true`
 */
export async function buildSpeechmaticsTranscriptionRequest(model, formData, { kind = "transcription" } = {}) {
  if (kind !== "transcription") return invalid("Speechmatics audio translations are not supported here");
  const entry = speechmaticsSttModel(model);
  if (!entry) return invalid(`Unsupported Speechmatics transcription model: ${model}. Use one of: ${SPEECHMATICS_STT_MODELS.map((m) => m.id).join(", ")}`);
  const file = field(formData, "file");
  if (!file || !isFunction(file.arrayBuffer)) {
    return invalid(field(formData, "url") !== null ? "Speechmatics transcription takes an uploaded file, not a url" : "Missing required field: file");
  }
  const stream = field(formData, "stream");
  if (stream !== null && String(stream).toLowerCase() !== "false") return invalid("Speechmatics transcription does not support streaming here");
  if (present(field(formData, "prompt"))) return invalid("Speechmatics transcription does not take prompt");
  const temperature = field(formData, "temperature");
  if (present(temperature) && Number(temperature) !== 0) return invalid("Speechmatics transcription does not support temperature");
  for (const name of SPEECHMATICS_UNSUPPORTED_FIELDS) {
    if (present(field(formData, name))) return invalid(`Speechmatics transcription does not support ${name.replace("[]", "")} here`);
  }

  const requested = field(formData, "response_format");
  if (requested !== null && !isString(requested)) return invalid("Speechmatics transcription response_format must be text");
  const responseFormat = requested ? requested.trim().toLowerCase() : "json";
  if (!SPEECHMATICS_TRANSCRIPTION_RESPONSE_FORMATS.includes(responseFormat)) {
    return invalid(`Speechmatics transcription supports response_format ${SPEECHMATICS_TRANSCRIPTION_RESPONSE_FORMATS.join(", ")}`);
  }

  const languageValue = field(formData, "language");
  if (languageValue !== null && !isString(languageValue)) return invalid("Speechmatics transcription language must be text");
  const requestedLanguage = isString(languageValue) ? languageValue.trim() : "";
  if (requestedLanguage && requestedLanguage !== SPEECHMATICS_AUTO_LANGUAGE && !LANGUAGE_PATTERN.test(requestedLanguage)) {
    return invalid("Speechmatics transcription language must be a language code such as en, or auto");
  }
  const language = requestedLanguage || SPEECHMATICS_AUTO_LANGUAGE;

  if (Number.isFinite(file.size) && file.size > SPEECHMATICS_MAX_STT_FILE_BYTES) return invalid("Speechmatics transcription file is too large");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) return invalid("Speechmatics transcription file is empty");
  if (bytes.length > SPEECHMATICS_MAX_STT_FILE_BYTES) return invalid("Speechmatics transcription file is too large");

  const config = speechmaticsJobConfig(entry.operatingPoint, language);
  // Source part order: `config` first, then the audio as `data_file`.
  const submission = new FormData();
  submission.append("config", JSON.stringify(config));
  const type = isString(file.type) && file.type && !/[\r\n]/.test(file.type) ? file.type : "application/octet-stream";
  submission.append("data_file", new Blob([bytes], { type }), speechmaticsUploadFileName(file));
  return { submission, config, responseFormat };
}

const remaining = (deadline, now) => deadline - now();
const positiveSeconds = (value) => (isNumber(value) && Number.isFinite(value) && value > 0 ? value : 0);

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.totalTimeoutMs] - one deadline for submission, polling and transcript
 * @param {number} [options.callTimeoutMs] - ceiling for each single HTTP call
 * @param {number} [options.pollIntervalMs]
 * @param {number} [options.maxTranscriptBytes]
 * @param {Function} [options.wait] - `(ms, signal)` sleep; tests inject a fast one
 * @param {Function} [options.now]
 */
export function createSpeechmaticsSttAdapter({
  fetchImpl,
  totalTimeoutMs = SPEECHMATICS_STT_TOTAL_TIMEOUT_MS,
  callTimeoutMs = SPEECHMATICS_STT_CALL_TIMEOUT_MS,
  pollIntervalMs = SPEECHMATICS_POLL_INTERVAL_MS,
  maxTranscriptBytes = SPEECHMATICS_MAX_TRANSCRIPT_BYTES,
  wait = sleep,
  now = Date.now,
} = {}) {
  /**
   * Poll one accepted job until it settles. Never resubmits the job.
   * @returns {Promise<{ done: true, audioSeconds: number } | { failure: object }>}
   */
  async function awaitJob(jobId, { headers, credentials, signal, deadline }) {
    const statusUrl = `${SPEECHMATICS_JOBS_URL}/${jobId}`;
    const aborted = () => ({ failure: withAcceptedJob(createErrorResult(499, "Speechmatics transcription aborted while the job was running"), MODALITY, "accepted", jobId) });
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
      const budget = Math.min(callTimeoutMs, remaining(deadline, now));
      if (budget <= 0) continue;
      let sent;
      try {
        sent = await boundedSend(statusUrl, { method: "GET", headers }, { fetchImpl, credentials, signal, timeoutMs: budget });
      } catch {
        if (signal?.aborted) return aborted();
        continue; // a status read is safe to repeat inside the deadline
      }
      const { response, fetchSignal } = sent;
      try {
        if (redirected(response)) return unknown("status check was redirected; the redirect was not followed");
        if (!response.ok) {
          if (TRANSIENT_POLL.has(response.status)) {
            discard(response);
            continue;
          }
          const refused = await refusedAnswer(response, { signal, modality: MODALITY, label: `${LABEL} status`, secrets: speechmaticsSecrets(credentials), billable: false });
          return { failure: withAcceptedJob(refused, MODALITY, "poll-failed", jobId) };
        }
        const record = await readJsonObject(response, { signal: fetchSignal, timeoutMs: Math.max(1, Math.min(budget, remaining(deadline, now))) });
        if (signal?.aborted) return aborted();
        const job = isRecord(record?.job) ? record.job : null;
        if (!job || !isString(job.status)) return unknown("status check returned an unreadable answer");
        const state = job.status.toLowerCase();
        if (state === "done") return { done: true, audioSeconds: positiveSeconds(job.duration) };
        // A rejected job produced no transcript; Speechmatics' error text is not quoted.
        if (FAILED_STATES.has(state)) return { failure: createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Speechmatics transcription job was ${state}`) };
        if (!PENDING_STATES.has(state)) return unknown("status check returned an unknown job state");
      } finally {
        sent.clear();
      }
    }
  }

  return {
    provider: SPEECHMATICS_PROVIDER_ID,
    models: SPEECHMATICS_STT_MODELS,
    responseFormats: SPEECHMATICS_TRANSCRIPTION_RESPONSE_FORMATS,
    /**
     * STT core result contract (sttCore.js): `{ success: true, response,
     * usageValue, nativeUnits, accounting }`, or an error result; `local` marks
     * caller input errors and `acceptedJob` marks a job Speechmatics may have
     * processed and billed.
     */
    async transcribe({ model, formData, credentials, kind, signal }) {
      const built = await buildSpeechmaticsTranscriptionRequest(model, formData, { kind });
      if (!built.submission) return built;
      const token = speechmaticsToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable Speechmatics API key on this connection");
      const auth = { Authorization: `Bearer ${token}` };
      const deadline = now() + totalTimeoutMs;
      const budget = () => Math.min(callTimeoutMs, remaining(deadline, now));

      // 1. Submit the job (audio and config in one body): billable, sent once, never replayed.
      const submitted = await sendOnce(SPEECHMATICS_JOBS_URL, { method: "POST", headers: { ...auth }, body: built.submission },
        { credentials, signal, fetchImpl, modality: MODALITY, label: LABEL, timeoutMs: budget(), billable: true });
      if (submitted.failure) return submitted.failure;
      let jobRecord;
      try {
        jobRecord = await readJsonObject(submitted.response, { signal: submitted.fetchSignal, timeoutMs: Math.max(1, budget()) });
      } finally {
        submitted.clear();
      }
      const jobId = jobRecord?.id;
      if (!isString(jobId) || !SAFE_ID.test(jobId)) return lostResult(MODALITY, LABEL, "job was accepted without a usable id", HTTP_STATUS.BAD_GATEWAY, "accepted");
      if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Speechmatics transcription aborted after the job was submitted"), MODALITY, "accepted", jobId);

      // 2. Poll.
      const settled = await awaitJob(jobId, { headers: auth, credentials, signal, deadline });
      if (settled.failure) return settled.failure;

      // 3. Transcript (plain text).
      const readBudget = budget();
      if (readBudget <= 0) return lostResult(MODALITY, LABEL, "transcript could not be read in time", HTTP_STATUS.GATEWAY_TIMEOUT, "accepted", jobId);
      let sent;
      try {
        sent = await boundedSend(`${SPEECHMATICS_JOBS_URL}/${jobId}/transcript?format=txt`, { method: "GET", headers: { ...auth, Accept: "text/plain" } },
          { fetchImpl, credentials, signal, timeoutMs: readBudget });
      } catch (error) {
        if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Speechmatics transcription aborted while reading the transcript"), MODALITY, "accepted", jobId);
        const timedOut = error?.name === "TimeoutError";
        return lostResult(MODALITY, LABEL, timedOut ? "transcript did not arrive in time" : "transcript could not be fetched", timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
      }
      const { response, fetchSignal } = sent;
      try {
        if (redirected(response)) return lostResult(MODALITY, LABEL, "transcript read was redirected; the redirect was not followed", HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
        if (!response.ok) {
          const refused = await refusedAnswer(response, { signal, modality: MODALITY, label: `${LABEL} transcript`, secrets: speechmaticsSecrets(credentials), billable: false });
          return withAcceptedJob(refused, MODALITY, "accepted", jobId);
        }
        const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (type && type !== "text/plain") {
          discard(response);
          return lostResult(MODALITY, LABEL, "returned an unreadable transcript", HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
        }
        let bytes;
        try {
          bytes = await readBounded(response.body, maxTranscriptBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY);
        } catch {
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Speechmatics transcription aborted while reading the transcript"), MODALITY, "accepted", jobId);
          if (sent.timedOut()) return lostResult(MODALITY, LABEL, "transcript did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT, "accepted", jobId);
          return lostResult(MODALITY, LABEL, "transcript was unreadable or too large", HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
        }
        let text;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          return lostResult(MODALITY, LABEL, "returned an unreadable transcript", HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
        }
        if (text.includes("\u0000")) return lostResult(MODALITY, LABEL, "returned an unreadable transcript", HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
        const accounting = mediaAccounting(null, SPEECHMATICS_PROVIDER_ID, MODALITY);
        accounting.meta = { model, operatingPoint: built.config.transcription_config.operating_point, responseFormat: built.responseFormat, jobId };
        const nativeUnits = settled.audioSeconds > 0 ? { audioSeconds: settled.audioSeconds } : {};
        accounting.nativeUnits = { ...nativeUnits };
        const clientResponse = built.responseFormat === "text"
          ? new Response(text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } })
          : new Response(JSON.stringify({ text }), { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
        return { success: true, response: clientResponse, usageValue: undefined, nativeUnits, accounting };
      } finally {
        sent.clear();
      }
    },
  };
}
