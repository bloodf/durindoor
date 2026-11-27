// Rev AI native asynchronous transcription: submit one job carrying the media,
// poll it, then read the plain-text transcript, all on https://api.rev.ai.
// Staged for /v1/audio/transcriptions and not registered (see
// ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/audioTranscription.ts handleRevAiTranscription
// (1. multipart `POST /speechtotext/v1/jobs` with the part `options` =
// `JSON.stringify({ transcriber: <model> })` followed by the file part `media`,
// `Authorization: Bearer <key>`, answer `{ id }`; 2. `GET /jobs/{id}` every 2 s
// for up to 120 s until `status` is "transcribed" or "failed"; 3.
// `GET /jobs/{id}/transcript` with `Accept: text/plain`, answer `{ text }`),
// open-sse/utils/audioMultipart.ts (buildMultipartBody: text fields before the
// file; getUploadedFileName: `.opus` relabelled `.ogg`, "audio.wav" when
// unnamed; `"` and CR/LF replaced by `_`) and open-sse/config/audioRegistry.ts
// (`rev-ai` transcription rows: machine, low_cost, fusion).
//
// Fork deviations: see ./http.js for transport; in addition one total deadline
// and a per-call ceiling; translations, streaming, a `url` input, any
// response_format other than json and text, `prompt`, a non-zero
// `temperature`, timestamp granularities, diarization flags, a language other
// than English (the source sends no language and Rev AI defaults to English),
// and a missing, empty or oversized file are refused before anything is sent;
// `text` output is returned as text/plain (the source answered JSON for every
// format); the submit is never retried or replayed; status checks continue past
// 429/5xx/transport errors only inside the deadline; a failed job, a refused or
// redirected status check, an unsafe job id and a malformed transcript never
// quote Rev AI's text (the source returned `failure_detail` and upstream error
// bodies verbatim); jobs and media are left on the account, as in the source.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { createErrorResult } from "../../../utils/error.js";
import { isFunction, isNumber, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  REVAI_JOBS_URL, REVAI_MAX_STT_FILE_BYTES, REVAI_MAX_TRANSCRIPT_BYTES, REVAI_POLL_INTERVAL_MS, REVAI_PROVIDER_ID,
  REVAI_STT_CALL_TIMEOUT_MS, REVAI_STT_MODELS, REVAI_STT_TOTAL_TIMEOUT_MS, revaiSttModel,
} from "./config.js";
import {
  boundedSend, discard, invalid, lostResult, readJsonObject, redirected, refusedAnswer, revaiSecrets, revaiToken, sendOnce,
  withAcceptedJob,
} from "./http.js";

const MODALITY = "stt";
const LABEL = "transcription";
/** Response formats this adapter returns. */
export const REVAI_TRANSCRIPTION_RESPONSE_FORMATS = Object.freeze(["json", "text"]);
/** Request fields that would change the result but the source never forwards: refused, not ignored. */
export const REVAI_UNSUPPORTED_FIELDS = Object.freeze([
  "timestamp_granularities[]", "timestamp_granularities",
  "enable_speaker_diarization", "diarization", "speaker_labels", "diarize",
]);
/** Rev AI's default language when `options.language` is absent, as in the source. */
const DEFAULT_LANGUAGE = /^en(?:[-_][A-Za-z0-9]{2,8})?$/i;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_FILE_NAME = 255;
const PENDING_STATES = new Set(["in_progress", "queued", "pending"]);
const TRANSIENT_POLL = new Set([408, 425, 429, 500, 502, 503, 504]);
const CORS = { "Access-Control-Allow-Origin": "*" };

const field = (formData, name) => (isFunction(formData?.get) ? formData.get(name) : null);
const present = (value) => value !== null && value !== undefined && !(isString(value) && value.trim() === "");

/** Source getUploadedFileName plus buildMultipartBody's quote and CR/LF replacement. */
export function revaiUploadFileName(file) {
  const raw = isString(file?.name) ? file.name.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, MAX_FILE_NAME) : "";
  const name = raw ? raw.replace(/\.opus$/i, ".ogg") : "audio.wav";
  return name.replace(/["]/g, "_").replace(/[\r\n]/g, "_");
}

/** The source `options` part: exactly `{ transcriber }`. */
export const revaiJobOptions = (modelId) => JSON.stringify({ transcriber: modelId });

/**
 * Check a transcription request and build the job body. Nothing is sent here.
 *
 * @returns {Promise<object>} `{ body: FormData, model, responseFormat }`, or a 400 error result with `local: true`
 */
export async function buildRevaiTranscriptionRequest(model, formData, { kind = "transcription" } = {}) {
  if (kind !== "transcription") return invalid("Rev AI audio translations are not supported here");
  const entry = revaiSttModel(model);
  if (!entry) return invalid(`Unsupported Rev AI transcription model: ${model}. Use one of: ${REVAI_STT_MODELS.map((m) => m.id).join(", ")}`);
  const file = field(formData, "file");
  if (!file || !isFunction(file.arrayBuffer)) {
    return invalid(field(formData, "url") !== null ? "Rev AI transcription takes an uploaded file, not a url" : "Missing required field: file");
  }
  const stream = field(formData, "stream");
  if (stream !== null && String(stream).toLowerCase() !== "false") return invalid("Rev AI transcription does not support streaming here");
  if (present(field(formData, "prompt"))) return invalid("Rev AI transcription does not take prompt");
  const temperature = field(formData, "temperature");
  if (present(temperature) && Number(temperature) !== 0) return invalid("Rev AI transcription does not support temperature");
  for (const name of REVAI_UNSUPPORTED_FIELDS) {
    if (present(field(formData, name))) return invalid(`Rev AI transcription does not support ${name.replace("[]", "")} here`);
  }
  const language = field(formData, "language");
  if (language !== null && !isString(language)) return invalid("Rev AI transcription language must be text");
  if (present(language) && !DEFAULT_LANGUAGE.test(language.trim())) return invalid("Rev AI transcription supports only English (en) here");

  const requested = field(formData, "response_format");
  if (requested !== null && !isString(requested)) return invalid("Rev AI transcription response_format must be text");
  const responseFormat = present(requested) ? requested.trim().toLowerCase() : "json";
  if (!REVAI_TRANSCRIPTION_RESPONSE_FORMATS.includes(responseFormat)) {
    return invalid(`Rev AI transcription supports response_format ${REVAI_TRANSCRIPTION_RESPONSE_FORMATS.join(", ")}`);
  }

  if (Number.isFinite(file.size) && file.size > REVAI_MAX_STT_FILE_BYTES) return invalid("Rev AI transcription file is too large");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) return invalid("Rev AI transcription file is empty");
  if (bytes.length > REVAI_MAX_STT_FILE_BYTES) return invalid("Rev AI transcription file is too large");

  // Source buildMultipartBody order: text fields first, then the file.
  const body = new FormData();
  body.append("options", revaiJobOptions(entry.id));
  const type = isString(file.type) && file.type && !/[\r\n]/.test(file.type) ? file.type : "application/octet-stream";
  body.append("media", new Blob([bytes], { type }), revaiUploadFileName(file));
  return { body, model: entry.id, responseFormat };
}

const remaining = (deadline, now) => deadline - now();
const TEXT_TYPE = /^text\/plain$/;

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.totalTimeoutMs] - one deadline for submit, polling and transcript
 * @param {number} [options.callTimeoutMs] - ceiling for each single HTTP call
 * @param {number} [options.pollIntervalMs]
 * @param {number} [options.maxTranscriptBytes]
 * @param {Function} [options.wait] - `(ms, signal)` sleep; tests inject a fast one
 * @param {Function} [options.now]
 */
export function createRevaiSttAdapter({
  fetchImpl,
  totalTimeoutMs = REVAI_STT_TOTAL_TIMEOUT_MS,
  callTimeoutMs = REVAI_STT_CALL_TIMEOUT_MS,
  pollIntervalMs = REVAI_POLL_INTERVAL_MS,
  maxTranscriptBytes = REVAI_MAX_TRANSCRIPT_BYTES,
  wait = sleep,
  now = Date.now,
} = {}) {
  /**
   * Poll one accepted job until it settles. Never re-submits the job.
   * @returns {Promise<{ done: true, durationSeconds: number } | { failure: object }>}
   */
  async function awaitJob(jobId, { headers, credentials, signal, deadline }) {
    const statusUrl = `${REVAI_JOBS_URL}/${jobId}`;
    const aborted = () => ({ failure: withAcceptedJob(createErrorResult(499, "Rev AI transcription aborted while the job was running"), MODALITY, "accepted", jobId) });
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
          const refused = await refusedAnswer(response, { signal, modality: MODALITY, label: `${LABEL} status`, secrets: revaiSecrets(credentials), billable: false });
          return { failure: withAcceptedJob(refused, MODALITY, "poll-failed", jobId) };
        }
        const record = await readJsonObject(response, { signal: fetchSignal, timeoutMs: Math.max(1, Math.min(budget, remaining(deadline, now))) });
        if (signal?.aborted) return aborted();
        if (!record || !isString(record.status)) return unknown("status check returned an unreadable answer");
        if (record.id !== undefined && record.id !== jobId) return unknown("status check answered for another job");
        const state = record.status.toLowerCase();
        if (state === "transcribed") {
          const seconds = isNumber(record.duration_seconds) && Number.isFinite(record.duration_seconds) && record.duration_seconds > 0
            ? record.duration_seconds : 0;
          return { done: true, durationSeconds: seconds };
        }
        // A failed job produced no transcript; Rev AI's failure_detail is not quoted.
        if (state === "failed") return { failure: createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Rev AI transcription job failed") };
        if (!PENDING_STATES.has(state)) return unknown("status check returned an unknown job state");
      } finally {
        sent.clear();
      }
    }
  }

  return {
    provider: REVAI_PROVIDER_ID,
    models: REVAI_STT_MODELS,
    responseFormats: REVAI_TRANSCRIPTION_RESPONSE_FORMATS,
    /**
     * STT core result contract (sttCore.js): `{ success: true, response,
     * usageValue, nativeUnits, accounting }`, or an error result; `local` marks
     * caller input errors and `acceptedJob` marks a job Rev AI may have
     * processed and billed.
     */
    async transcribe({ model, formData, credentials, kind, signal }) {
      const built = await buildRevaiTranscriptionRequest(model, formData, { kind });
      if (!built.body) return built;
      const token = revaiToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable Rev AI API key on this connection");
      const auth = { Authorization: `Bearer ${token}` };
      const deadline = now() + totalTimeoutMs;
      const budget = () => Math.min(callTimeoutMs, remaining(deadline, now));

      // 1. Submit the job with the media: billable, sent once, never replayed.
      const submitted = await sendOnce(REVAI_JOBS_URL, { method: "POST", headers: { ...auth }, body: built.body },
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
      if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Rev AI transcription aborted after the job was submitted"), MODALITY, "accepted", jobId);

      // 2. Poll.
      const settled = await awaitJob(jobId, { headers: auth, credentials, signal, deadline });
      if (settled.failure) return settled.failure;

      // 3. Plain-text transcript.
      const readBudget = budget();
      if (readBudget <= 0) return lostResult(MODALITY, LABEL, "transcript could not be read in time", HTTP_STATUS.GATEWAY_TIMEOUT, "accepted", jobId);
      let sent;
      try {
        sent = await boundedSend(`${REVAI_JOBS_URL}/${jobId}/transcript`, { method: "GET", headers: { ...auth, Accept: "text/plain" } },
          { fetchImpl, credentials, signal, timeoutMs: readBudget });
      } catch (error) {
        if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Rev AI transcription aborted while reading the transcript"), MODALITY, "accepted", jobId);
        const timedOut = error?.name === "TimeoutError";
        return lostResult(MODALITY, LABEL, timedOut ? "transcript did not arrive in time" : "transcript could not be fetched", timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
      }
      const { response, fetchSignal } = sent;
      try {
        if (redirected(response)) return lostResult(MODALITY, LABEL, "transcript read was redirected; the redirect was not followed", HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
        if (!response.ok) {
          const refused = await refusedAnswer(response, { signal, modality: MODALITY, label: `${LABEL} transcript`, secrets: revaiSecrets(credentials), billable: false });
          return withAcceptedJob(refused, MODALITY, "accepted", jobId);
        }
        const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (type && !TEXT_TYPE.test(type)) {
          discard(response);
          return lostResult(MODALITY, LABEL, "returned an unreadable transcript", HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
        }
        let text;
        try {
          text = (await readBounded(response.body, maxTranscriptBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY)).toString("utf8");
        } catch {
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Rev AI transcription aborted while reading the transcript"), MODALITY, "accepted", jobId);
          if (sent.timedOut()) return lostResult(MODALITY, LABEL, "transcript did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT, "accepted", jobId);
          return lostResult(MODALITY, LABEL, "transcript was unreadable or too large", HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
        }
        if (text.includes("\u0000")) return lostResult(MODALITY, LABEL, "returned an unreadable transcript", HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
        const accounting = mediaAccounting(null, REVAI_PROVIDER_ID, MODALITY);
        accounting.meta = { model: built.model, responseFormat: built.responseFormat, jobId };
        const nativeUnits = settled.durationSeconds > 0 ? { audioSeconds: settled.durationSeconds } : {};
        accounting.nativeUnits = { ...nativeUnits };
        const clientResponse = built.responseFormat === "text"
          ? new Response(text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } })
          : new Response(JSON.stringify({ text: text || "" }), { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
        return { success: true, response: clientResponse, usageValue: undefined, nativeUnits, accounting };
      } finally {
        sent.clear();
      }
    },
  };
}
