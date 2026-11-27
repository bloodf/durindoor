// Soniox native asynchronous transcription: upload the file, create a job,
// poll it, then read the transcript, all on https://api.soniox.com. Staged for
// /v1/audio/transcriptions and not registered (see ./registration.json).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/audioTranscription.ts handleSonioxTranscription
// (1. multipart `POST /v1/files` with the single part `file` and
// `Authorization: Bearer <key>`, answer `{ id }`; 2. JSON
// `POST /v1/transcriptions` with `{ model, file_id,
// enable_language_identification: true }` plus `enable_speaker_diarization:
// true`, `context` and `language_hints: [language]` only when asked, answer
// `{ id }`; 3. `GET /v1/transcriptions/{id}` every 2 s for up to 120 s until
// `status` is "completed" or "error"; 4. `GET /v1/transcriptions/{id}/transcript`,
// text from `text` or the joined token texts; `{ text }` by default, or a
// verbose_json body with speaker segments, language, duration and, for
// `timestamp_granularities[]=word`, words), readSonioxOptions and
// readDiarizationFlag (diarization under `enable_speaker_diarization`,
// `diarization`, `speaker_labels` or `diarize`; diarization implies verbose),
// groupSonioxTokensBySpeaker, open-sse/utils/audioMultipart.ts
// (getUploadedFileName: `.opus` relabelled `.ogg`, "audio.wav" when unnamed;
// `"` and CR/LF replaced by `_`) and open-sse/config/audioRegistry.ts
// (`soniox` transcription row: stt-async-v5, stt-async-v4).
//
// Fork deviations: see ./http.js for transport; in addition one total
// deadline and a per-call ceiling; translations, streaming, a `url` input,
// srt/vtt and unknown response formats, `prompt`, a non-zero `temperature`,
// timestamp granularities without a verbose body, `text` output with
// diarization, malformed language or context, and a missing, empty or
// oversized file are refused before anything is uploaded; `text` output is
// returned as text/plain (the source answered JSON for every format); the
// upload is never retried; the create is never retried or replayed; status
// checks continue past 429/5xx/transport errors only inside the deadline; a
// failed job, a refused or redirected status check, an unsafe job id and a
// malformed transcript never quote Soniox's text; files and jobs are left on
// the account, as in the source.
import { Buffer } from "node:buffer";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { readBounded } from "../../../handlers/codexSttAudio.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { createErrorResult, errorEnvelopeMessage } from "../../../utils/error.js";
import { isFunction, isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  SONIOX_FILES_URL, SONIOX_MAX_STT_FILE_BYTES, SONIOX_MAX_TRANSCRIPT_BYTES, SONIOX_POLL_INTERVAL_MS, SONIOX_PROVIDER_ID,
  SONIOX_STT_CALL_TIMEOUT_MS, SONIOX_STT_MODELS, SONIOX_STT_TOTAL_TIMEOUT_MS, SONIOX_TRANSCRIPTIONS_URL, sonioxSttModel,
} from "./config.js";
import {
  boundedSend, discard, invalid, lostResult, readJsonObject, redirected, refusedAnswer, sendOnce, sonioxSecrets, sonioxToken,
  withAcceptedJob,
} from "./http.js";

const MODALITY = "stt";
const LABEL = "transcription";
/** Response formats this adapter returns. */
export const SONIOX_TRANSCRIPTION_RESPONSE_FORMATS = Object.freeze(["json", "text", "verbose_json"]);
/** Source readDiarizationFlag spellings. */
export const SONIOX_DIARIZATION_FIELDS = Object.freeze(["enable_speaker_diarization", "diarization", "speaker_labels", "diarize"]);
const GRANULARITY_FIELDS = Object.freeze(["timestamp_granularities[]", "timestamp_granularities"]);
const TRUTHY = /^(1|true|yes|on)$/i;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/;
const MAX_FILE_NAME = 255;
const MAX_CONTEXT = 10_000;
const PENDING_STATES = new Set(["queued", "processing", "pending", "running", "in_progress"]);
const TRANSIENT_POLL = new Set([408, 425, 429, 500, 502, 503, 504]);
const CORS = { "Access-Control-Allow-Origin": "*" };

const field = (formData, name) => (isFunction(formData?.get) ? formData.get(name) : null);
const fields = (formData, name) => (isFunction(formData?.getAll) ? formData.getAll(name) : []);
const textField = (formData, name) => {
  const value = field(formData, name);
  return isString(value) ? value.trim() : "";
};

/** Source getUploadedFileName plus buildMultipartBody's quote and CR/LF replacement. */
export function sonioxUploadFileName(file) {
  const raw = isString(file?.name) ? file.name.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, MAX_FILE_NAME) : "";
  const name = raw ? raw.replace(/\.opus$/i, ".ogg") : "audio.wav";
  return name.replace(/["]/g, "_").replace(/[\r\n]/g, "_");
}

/** Source readDiarizationFlag: any truthy spelling enables diarization. */
export const readSonioxDiarization = (formData) => SONIOX_DIARIZATION_FIELDS.some((key) => TRUTHY.test(textField(formData, key)));

/**
 * Check a transcription request and build the upload body and job options.
 * Nothing is sent here.
 *
 * @returns {Promise<object>} `{ upload: FormData, job: object, responseFormat, verbose, wantWords }`, or a 400 error result with `local: true`
 */
export async function buildSonioxTranscriptionRequest(model, formData, { kind = "transcription" } = {}) {
  if (kind !== "transcription") return invalid("Soniox audio translations are not supported here");
  const entry = sonioxSttModel(model);
  if (!entry) return invalid(`Unsupported Soniox transcription model: ${model}. Use one of: ${SONIOX_STT_MODELS.map((m) => m.id).join(", ")}`);
  const file = field(formData, "file");
  if (!file || !isFunction(file.arrayBuffer)) {
    return invalid(field(formData, "url") !== null ? "Soniox transcription takes an uploaded file, not a url" : "Missing required field: file");
  }
  const stream = field(formData, "stream");
  if (stream !== null && String(stream).toLowerCase() !== "false") return invalid("Soniox transcription does not support streaming here");
  const prompt = field(formData, "prompt");
  if (prompt !== null && prompt !== "") return invalid("Soniox transcription does not take prompt; send context instead");
  const temperature = field(formData, "temperature");
  if (temperature !== null && temperature !== "" && Number(temperature) !== 0) return invalid("Soniox transcription does not support temperature");

  const requested = field(formData, "response_format");
  if (requested !== null && !isString(requested)) return invalid("Soniox transcription response_format must be text");
  const responseFormat = requested ? requested.trim().toLowerCase() : "json";
  if (!SONIOX_TRANSCRIPTION_RESPONSE_FORMATS.includes(responseFormat)) {
    return invalid(`Soniox transcription supports response_format ${SONIOX_TRANSCRIPTION_RESPONSE_FORMATS.join(", ")}`);
  }
  const diarize = readSonioxDiarization(formData);
  if (diarize && responseFormat === "text") return invalid("Soniox diarization needs a JSON response_format");
  const verbose = diarize || responseFormat === "verbose_json";

  const granularities = [...new Set(GRANULARITY_FIELDS.flatMap((name) => fields(formData, name))
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean))];
  for (const granularity of granularities) {
    if (granularity !== "segment" && granularity !== "word") return invalid("Soniox timestamp_granularities supports segment and word");
  }
  if (granularities.length && !verbose) return invalid("Soniox timestamp_granularities need response_format verbose_json");

  const languageValue = field(formData, "language");
  if (languageValue !== null && !isString(languageValue)) return invalid("Soniox transcription language must be text");
  const language = textField(formData, "language");
  if (language && !LANGUAGE_PATTERN.test(language)) return invalid("Soniox transcription language must be a language code such as en");
  const contextValue = field(formData, "context");
  if (contextValue !== null && !isString(contextValue)) return invalid("Soniox transcription context must be text");
  const context = textField(formData, "context");
  if (context.length > MAX_CONTEXT) return invalid("Soniox transcription context is too long");

  if (Number.isFinite(file.size) && file.size > SONIOX_MAX_STT_FILE_BYTES) return invalid("Soniox transcription file is too large");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length === 0) return invalid("Soniox transcription file is empty");
  if (bytes.length > SONIOX_MAX_STT_FILE_BYTES) return invalid("Soniox transcription file is too large");

  const upload = new FormData();
  const type = isString(file.type) && file.type && !/[\r\n]/.test(file.type) ? file.type : "application/octet-stream";
  upload.append("file", new Blob([bytes], { type }), sonioxUploadFileName(file));

  // Only options the caller asked for are added (source readSonioxOptions).
  const job = { model: entry.id, enable_language_identification: true };
  if (diarize) job.enable_speaker_diarization = true;
  if (context) job.context = context;
  if (language) job.language_hints = [language];
  return { upload, job, responseFormat, verbose, wantWords: granularities.includes("word") };
}

/** The source job body, in source key order: model, file_id, then the options. */
export function sonioxJobBody(job, fileId) {
  const { model, ...options } = job;
  return { model, file_id: fileId, ...options };
}

const finite = (value, fallback = 0) => (isNumber(value) && Number.isFinite(value) ? value : fallback);

/** Source groupSonioxTokensBySpeaker. */
export function groupSonioxTokensBySpeaker(tokens) {
  const segments = [];
  for (const token of tokens) {
    const speaker = token.speaker === null || token.speaker === undefined ? null : String(token.speaker);
    const previous = segments[segments.length - 1];
    const text = isString(token.text) ? token.text : "";
    if (!previous || previous.speaker !== speaker) {
      const startMs = finite(token.start_ms);
      segments.push({ speaker, startMs, endMs: finite(token.end_ms, startMs), text });
      continue;
    }
    previous.endMs = finite(token.end_ms, previous.endMs);
    previous.text += text;
  }
  return segments;
}

/**
 * The source's client body from a Soniox transcript object, or null when the
 * transcript is unusable. Token entries that are not objects are dropped.
 */
export function sonioxTranscriptBody(transcript, { verbose = false, wantWords = false } = {}) {
  if (!isRecord(transcript)) return null;
  if (transcript.tokens !== undefined && !Array.isArray(transcript.tokens)) return null;
  const tokens = (transcript.tokens ?? []).filter(isRecord);
  if (transcript.text !== undefined && !isString(transcript.text)) return null;
  if (!isString(transcript.text) && !tokens.length) return null;
  const text = isString(transcript.text) && transcript.text.length > 0
    ? transcript.text
    : tokens.map((token) => (isString(token.text) ? token.text : "")).join("");
  const durationMs = tokens.length ? finite(tokens[tokens.length - 1].end_ms) : 0;
  if (!verbose) return { body: { text }, audioSeconds: durationMs / 1000 };
  const segments = groupSonioxTokensBySpeaker(tokens).map((segment, index) => ({
    id: index,
    start: segment.startMs / 1000,
    end: segment.endMs / 1000,
    text: segment.text.trim(),
    ...(segment.speaker !== null ? { speaker: segment.speaker } : {}),
  }));
  const language = tokens.find((token) => isString(token.language) && token.language)?.language;
  return {
    body: {
      task: "transcribe",
      ...(language ? { language } : {}),
      duration: durationMs / 1000,
      text,
      segments,
      ...(wantWords
        ? {
          words: tokens.map((token) => ({
            word: isString(token.text) ? token.text : "",
            start: finite(token.start_ms) / 1000,
            end: finite(token.end_ms) / 1000,
            ...(token.speaker !== null && token.speaker !== undefined ? { speaker: String(token.speaker) } : {}),
          })),
        }
        : {}),
    },
    audioSeconds: durationMs / 1000,
  };
}

const remaining = (deadline, now) => deadline - now();

/**
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - transport, proxyAwareFetch by default; tests inject a mock
 * @param {number} [options.totalTimeoutMs] - one deadline for upload, create, polling and transcript
 * @param {number} [options.callTimeoutMs] - ceiling for each single HTTP call
 * @param {number} [options.pollIntervalMs]
 * @param {number} [options.maxTranscriptBytes]
 * @param {Function} [options.wait] - `(ms, signal)` sleep; tests inject a fast one
 * @param {Function} [options.now]
 */
export function createSonioxSttAdapter({
  fetchImpl,
  totalTimeoutMs = SONIOX_STT_TOTAL_TIMEOUT_MS,
  callTimeoutMs = SONIOX_STT_CALL_TIMEOUT_MS,
  pollIntervalMs = SONIOX_POLL_INTERVAL_MS,
  maxTranscriptBytes = SONIOX_MAX_TRANSCRIPT_BYTES,
  wait = sleep,
  now = Date.now,
} = {}) {
  /**
   * Poll one accepted job until it settles. Never re-creates the job.
   * @returns {Promise<{ done: true } | { failure: object }>}
   */
  async function awaitJob(jobId, { headers, credentials, signal, deadline }) {
    const statusUrl = `${SONIOX_TRANSCRIPTIONS_URL}/${jobId}`;
    const aborted = () => ({ failure: withAcceptedJob(createErrorResult(499, "Soniox transcription aborted while the job was running"), MODALITY, "accepted", jobId) });
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
          const refused = await refusedAnswer(response, { signal, modality: MODALITY, label: `${LABEL} status`, secrets: sonioxSecrets(credentials), billable: false });
          return { failure: withAcceptedJob(refused, MODALITY, "poll-failed", jobId) };
        }
        const record = await readJsonObject(response, { signal: fetchSignal, timeoutMs: Math.max(1, Math.min(budget, remaining(deadline, now))) });
        if (signal?.aborted) return aborted();
        if (!record || !isString(record.status)) return unknown("status check returned an unreadable answer");
        const state = record.status.toLowerCase();
        if (state === "completed") return { done: true };
        // A failed job produced no transcript; Soniox's error text is not quoted.
        if (state === "error" || state === "failed") return { failure: createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Soniox transcription job failed") };
        if (!PENDING_STATES.has(state)) return unknown("status check returned an unknown job state");
      } finally {
        sent.clear();
      }
    }
  }

  return {
    provider: SONIOX_PROVIDER_ID,
    models: SONIOX_STT_MODELS,
    responseFormats: SONIOX_TRANSCRIPTION_RESPONSE_FORMATS,
    /**
     * STT core result contract (sttCore.js): `{ success: true, response,
     * usageValue, nativeUnits, accounting }`, or an error result; `local` marks
     * caller input errors and `acceptedJob` marks a job Soniox may have
     * processed and billed.
     */
    async transcribe({ model, formData, credentials, kind, signal }) {
      const built = await buildSonioxTranscriptionRequest(model, formData, { kind });
      if (!built.upload) return built;
      const token = sonioxToken(credentials);
      if (!token) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, "No usable Soniox API key on this connection");
      const auth = { Authorization: `Bearer ${token}` };
      const deadline = now() + totalTimeoutMs;
      const budget = () => Math.min(callTimeoutMs, remaining(deadline, now));
      const context = { credentials, signal, fetchImpl };

      // 1. Upload. Stores audio but bills nothing, so an unknown outcome carries no acceptedJob.
      const uploaded = await sendOnce(SONIOX_FILES_URL, { method: "POST", headers: { ...auth }, body: built.upload },
        { ...context, modality: MODALITY, label: "file upload", timeoutMs: budget(), billable: false });
      if (uploaded.failure) return uploaded.failure;
      let fileRecord;
      try {
        fileRecord = await readJsonObject(uploaded.response, { signal: uploaded.fetchSignal, timeoutMs: Math.max(1, budget()) });
      } finally {
        uploaded.clear();
      }
      if (signal?.aborted) return { ...createErrorResult(499, "Soniox transcription aborted before the job was created"), local: true };
      const fileId = fileRecord?.id;
      if (!isString(fileId) || !SAFE_ID.test(fileId)) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Soniox file upload returned no usable file id");
      if (budget() <= 0) return createErrorResult(HTTP_STATUS.GATEWAY_TIMEOUT, "Soniox transcription ran out of time before the job was created");

      // 2. Create the job: billable, sent once, never replayed.
      const created = await sendOnce(SONIOX_TRANSCRIPTIONS_URL, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(sonioxJobBody(built.job, fileId)),
      }, { ...context, modality: MODALITY, label: LABEL, timeoutMs: budget(), billable: true });
      if (created.failure) return created.failure;
      let jobRecord;
      try {
        jobRecord = await readJsonObject(created.response, { signal: created.fetchSignal, timeoutMs: Math.max(1, budget()) });
      } finally {
        created.clear();
      }
      const jobId = jobRecord?.id;
      if (!isString(jobId) || !SAFE_ID.test(jobId)) return lostResult(MODALITY, LABEL, "job was accepted without a usable id", HTTP_STATUS.BAD_GATEWAY, "accepted");
      if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Soniox transcription aborted after the job was created"), MODALITY, "accepted", jobId);

      // 3. Poll.
      const settled = await awaitJob(jobId, { headers: auth, credentials, signal, deadline });
      if (settled.failure) return settled.failure;

      // 4. Transcript.
      const readBudget = budget();
      if (readBudget <= 0) return lostResult(MODALITY, LABEL, "transcript could not be read in time", HTTP_STATUS.GATEWAY_TIMEOUT, "accepted", jobId);
      let sent;
      try {
        sent = await boundedSend(`${SONIOX_TRANSCRIPTIONS_URL}/${jobId}/transcript`, { method: "GET", headers: auth }, { fetchImpl, credentials, signal, timeoutMs: readBudget });
      } catch (error) {
        if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Soniox transcription aborted while reading the transcript"), MODALITY, "accepted", jobId);
        const timedOut = error?.name === "TimeoutError";
        return lostResult(MODALITY, LABEL, timedOut ? "transcript did not arrive in time" : "transcript could not be fetched", timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
      }
      const { response, fetchSignal } = sent;
      try {
        if (redirected(response)) return lostResult(MODALITY, LABEL, "transcript read was redirected; the redirect was not followed", HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
        if (!response.ok) {
          const refused = await refusedAnswer(response, { signal, modality: MODALITY, label: `${LABEL} transcript`, secrets: sonioxSecrets(credentials), billable: false });
          return withAcceptedJob(refused, MODALITY, "accepted", jobId);
        }
        const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (type && !/(^application\/json$|\+json$)/.test(type)) {
          discard(response);
          return lostResult(MODALITY, LABEL, "returned an unreadable transcript", HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
        }
        let text;
        try {
          text = (await readBounded(response.body, maxTranscriptBytes, fetchSignal, HTTP_STATUS.BAD_GATEWAY)).toString("utf8");
        } catch {
          if (signal?.aborted) return withAcceptedJob(createErrorResult(499, "Soniox transcription aborted while reading the transcript"), MODALITY, "accepted", jobId);
          if (sent.timedOut()) return lostResult(MODALITY, LABEL, "transcript did not arrive in time", HTTP_STATUS.GATEWAY_TIMEOUT, "accepted", jobId);
          return lostResult(MODALITY, LABEL, "transcript was unreadable or too large", HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
        }
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          // The parser's message quotes the body, so it is dropped.
        }
        if (isRecord(data) && errorEnvelopeMessage(data)) {
          return lostResult(MODALITY, LABEL, "answered with an error payload instead of a transcript", HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
        }
        const shaped = sonioxTranscriptBody(data, built);
        if (!shaped) return lostResult(MODALITY, LABEL, "returned an unreadable transcript", HTTP_STATUS.BAD_GATEWAY, "accepted", jobId);
        const accounting = mediaAccounting(null, SONIOX_PROVIDER_ID, MODALITY);
        accounting.meta = { model: built.job.model, responseFormat: built.responseFormat, jobId };
        const nativeUnits = shaped.audioSeconds > 0 ? { audioSeconds: shaped.audioSeconds } : {};
        accounting.nativeUnits = { ...nativeUnits };
        const clientResponse = built.responseFormat === "text"
          ? new Response(shaped.body.text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS } })
          : new Response(JSON.stringify(shaped.body), { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
        return { success: true, response: clientResponse, usageValue: undefined, nativeUnits, accounting };
      } finally {
        sent.clear();
      }
    },
  };
}
