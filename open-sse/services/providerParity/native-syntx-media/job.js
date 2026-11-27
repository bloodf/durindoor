// The SYNTX media job (source syntxMedia.ts): create a chat with a scope,
// POST /api/v1/{design|video|audio}/generate?ai_name=, then poll
// GET /api/v1/chats/{uuid}/messages until the latest assistant message
// (author_id -1) has every message_object completed. Reference files go
// through POST /api/v1/chats/upload-files first.
//
// No replay: chat creation and uploads bill nothing and are not retried; the
// generate POST is sent exactly once. From the moment it may have reached
// SYNTX, every failure (transport error after send, 5xx, foreign origin,
// abort, poll loss, deadline, unsafe or missing output) carries `acceptedJob`
// so the caller records it and does not fall back to another account.
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import {
  SYNTX_CHATS_URL, SYNTX_JSON_MAX_BYTES, SYNTX_MAX_POLL_ERRORS, SYNTX_MAX_RESULTS, SYNTX_MEDIA_MAX_BYTES,
  SYNTX_MIN_POLL_TIMEOUT_MS, SYNTX_POLL_INTERVAL_MS, SYNTX_POLL_MAX_BYTES, SYNTX_POLL_TIMEOUT_MS, SYNTX_PROVIDER_ID,
  SYNTX_REQUEST_TIMEOUT_MS, SYNTX_SUBMIT_TIMEOUT_MS, SYNTX_UPLOAD_TIMEOUT_MS, SYNTX_UPLOAD_URL, syntxGenerateUrl,
  syntxMessagesUrl,
} from "./config.js";
import { syntxApiHeaders } from "./auth.js";
import { syntxPublicUrl } from "./download.js";
import {
  boundedFetch, defaultSyntxFetch, discard, fail, offOrigin, parseJson, provenUnsent, readText, refusedAnswer,
  withAcceptedJob,
} from "./http.js";
import { isObject, isString } from "../../../../src/shared/utils/typeChecks.js";

const CHAT_UUID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const MEDIA_OBJECT_TYPES = new Set(["image", "video", "audio", "file"]);
const IMMEDIATE_URL_KEYS = ["object_url", "url", "image_url", "video_url", "audio_url", "file_url", "download_url"];
const MAX_WALK_DEPTH = 8;

const asRecord = (value) => (value && isObject(value) && !Array.isArray(value) ? value : {});
const asString = (value) => (isString(value) ? value : "");

/** Source chatTitleFromText. */
export const syntxChatTitle = (text) => (String(text || "media").replace(/\s+/g, " ").trim().slice(0, 60) || "media");

/** Clamp a caller deadline (source honors body.timeout_ms unbounded) to [1 s, 600 s]. */
export function syntxPollTimeout(value) {
  if (!Number.isFinite(value) || value <= 0) return SYNTX_POLL_TIMEOUT_MS;
  return Math.min(SYNTX_POLL_TIMEOUT_MS, Math.max(SYNTX_MIN_POLL_TIMEOUT_MS, Math.floor(value)));
}

/**
 * Source collectSyntxCompletedMedia: ready only when every message_object is
 * completed, so a partially finished message is never returned.
 */
export function collectSyntxCompletedMedia(message) {
  const objects = Array.isArray(asRecord(message).message_object) ? asRecord(message).message_object : [];
  if (objects.length === 0) return { text: "", media: [], ready: false };
  const ready = objects.every((item) => asRecord(item).completed === true);
  const text = [];
  const media = [];
  for (const item of objects) {
    const obj = asRecord(item);
    const type = asString(obj.object_type);
    if (type === "text" || type === "filetext") {
      if (asString(obj.object_text)) text.push(obj.object_text);
    } else if (MEDIA_OBJECT_TYPES.has(type) && asString(obj.object_url)) {
      media.push({ objectType: type, url: obj.object_url });
    }
  }
  return { text: text.join(text.length > 1 ? "\n\n" : ""), media, ready };
}

/** Source messagesFromPollJson + latest assistant (author_id === -1). */
export function latestSyntxAssistantMessage(json) {
  const messages = Array.isArray(asRecord(json).messages) ? json.messages : Array.isArray(json) ? json : [];
  const assistants = messages.filter((item) => asRecord(item).author_id === -1);
  return assistants[assistants.length - 1] ?? null;
}

/**
 * Source extractUrlsDeep over the generate answer: http(s) strings outside
 * `syntx.ai/api/`, bounded in depth. Used only when the finished chat
 * message carries no media, as the source does.
 */
export function extractSyntxImmediateUrls(value, kindHint, into = [], depth = 0) {
  if (!value || depth > MAX_WALK_DEPTH) return into;
  if (isString(value)) {
    if (/^https?:\/\//i.test(value) && !value.includes("syntx.ai/api/")) into.push({ objectType: kindHint, url: value });
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) extractSyntxImmediateUrls(item, kindHint, into, depth + 1);
    return into;
  }
  if (!isObject(value)) return into;
  for (const key of IMMEDIATE_URL_KEYS) {
    const raw = value[key];
    if (isString(raw) && /^https?:\/\//i.test(raw)) into.push({ objectType: kindHint, url: raw });
  }
  for (const nested of Object.values(value)) {
    if (nested && isObject(nested)) extractSyntxImmediateUrls(nested, kindHint, into, depth + 1);
  }
  return into;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => item.url && !seen.has(item.url) && seen.add(item.url));
}

function stopStatus(error, signal) {
  if (signal?.aborted || error?.name === "AbortError") return 499;
  if (error?.name === "TimeoutError") return HTTP_STATUS.GATEWAY_TIMEOUT;
  return HTTP_STATUS.BAD_GATEWAY;
}

/** One JSON request to the API origin before any job exists (chat create, upload). */
async function preJobRequest({ url, init, label, token, credentials, secrets, signal, timeoutMs, fetchImpl }) {
  let response;
  try {
    response = await boundedFetch(fetchImpl, url, { ...init, headers: { ...syntxApiHeaders(token), ...init.headers } }, { signal, timeoutMs, credentials });
  } catch (error) {
    const status = stopStatus(error, signal);
    return { failure: fail(status, `SYNTX ${label} ${status === 499 ? "was cancelled" : status === 504 ? "timed out" : "could not be sent"}`, secrets) };
  }
  const away = offOrigin(response);
  if (away) return { failure: fail(HTTP_STATUS.BAD_GATEWAY, `SYNTX ${label} was redirected; the redirect was not followed`, secrets) };
  if (!response.ok) return { failure: await refusedAnswer(response, { signal, timeoutMs, label, secrets }) };
  let text;
  try {
    text = await readText(response, { signal, timeoutMs, maxBytes: SYNTX_JSON_MAX_BYTES });
  } catch (error) {
    return { failure: fail(error?.unreadable ? HTTP_STATUS.BAD_GATEWAY : stopStatus(error, signal), `SYNTX ${label} answer could not be read`, secrets) };
  }
  return { json: parseJson(text) };
}

/** POST /api/v1/chats { title, scope } → chat uuid. Bills nothing; never retried. */
export async function createSyntxChat({ token, credentials, secrets, scope, title, signal, options = {} }) {
  const { failure, json } = await preJobRequest({
    url: SYNTX_CHATS_URL,
    init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: syntxChatTitle(title), scope }) },
    label: "chat creation", token, credentials, secrets, signal,
    timeoutMs: options.requestTimeoutMs ?? SYNTX_REQUEST_TIMEOUT_MS,
    fetchImpl: options.fetchImpl ?? defaultSyntxFetch,
  });
  if (failure) return failure;
  const uuid = asString(asRecord(json).uuid);
  if (!CHAT_UUID_RE.test(uuid)) return fail(HTTP_STATUS.BAD_GATEWAY, "SYNTX chat creation returned no usable chat id", secrets);
  return { success: true, chatUuid: uuid };
}

/**
 * Source uploadSyntxMediaFile: multipart `files`, `destination=uploaded`,
 * `check_duplicates=true`, empty `model_type`; the URL is files[0].url or
 * data.files[0].url and must be public https.
 */
export async function uploadSyntxReference({ token, credentials, secrets, bytes, filename, mimeType, signal, options = {} }) {
  const maxBytes = options.maxUploadBytes ?? SYNTX_MEDIA_MAX_BYTES;
  if (!bytes || bytes.byteLength === 0) return fail(HTTP_STATUS.BAD_REQUEST, "SYNTX reference file is empty");
  if (bytes.byteLength > maxBytes) return fail(HTTP_STATUS.BAD_REQUEST, `SYNTX reference file exceeds ${maxBytes} bytes`);
  const form = new FormData();
  const safeName = String(filename || "upload.bin").replace(/["\r\n/\\]/g, "_").slice(0, 128) || "upload.bin";
  const safeMime = String(mimeType || "application/octet-stream").replace(/[\r\n]/g, "") || "application/octet-stream";
  form.append("files", new Blob([bytes], { type: safeMime }), safeName);
  form.append("destination", "uploaded");
  form.append("check_duplicates", "true");
  form.append("model_type", "");
  const { failure, json } = await preJobRequest({
    url: SYNTX_UPLOAD_URL, init: { method: "POST", headers: {}, body: form },
    label: "reference upload", token, credentials, secrets, signal,
    timeoutMs: options.uploadTimeoutMs ?? SYNTX_UPLOAD_TIMEOUT_MS,
    fetchImpl: options.fetchImpl ?? defaultSyntxFetch,
  });
  if (failure) return failure;
  const files = Array.isArray(asRecord(json).files) ? json.files : Array.isArray(asRecord(asRecord(json).data).files) ? json.data.files : [];
  const url = syntxPublicUrl(asString(asRecord(files[0]).url));
  if (!url) return fail(HTTP_STATUS.BAD_GATEWAY, "SYNTX rejected the reference upload", secrets);
  return { success: true, url };
}

async function submitGenerate({ route, aiName, payload, token, credentials, secrets, signal, modality, options }) {
  const timeoutMs = options.submitTimeoutMs ?? SYNTX_SUBMIT_TIMEOUT_MS;
  let response;
  try {
    response = await boundedFetch(options.fetchImpl ?? defaultSyntxFetch, syntxGenerateUrl(route, aiName), {
      method: "POST",
      headers: { ...syntxApiHeaders(token), "content-type": "application/json" },
      body: JSON.stringify(payload),
    }, { signal, timeoutMs, credentials });
  } catch (error) {
    const status = stopStatus(error, signal);
    if (provenUnsent(error)) return { failure: fail(status, `SYNTX ${modality} generate ${status === 499 ? "was cancelled" : "could not be sent"}`, secrets) };
    return { failure: withAcceptedJob(fail(status, `SYNTX ${modality} generate was interrupted; whether it was accepted is unknown`, secrets), modality, "submit-unknown") };
  }
  const away = offOrigin(response);
  if (away === "redirect") return { failure: fail(HTTP_STATUS.BAD_GATEWAY, `SYNTX ${modality} generate was redirected; the redirect was not followed`, secrets) };
  if (away === "foreign") return { failure: withAcceptedJob(fail(HTTP_STATUS.BAD_GATEWAY, `SYNTX ${modality} generate was answered by another origin`, secrets), modality, "submit-unknown") };
  if (!response.ok) {
    const refused = await refusedAnswer(response, { signal, timeoutMs, label: `${modality} generate`, secrets });
    return { failure: response.status >= 500 ? withAcceptedJob(refused, modality, "submit-unknown") : refused };
  }
  try {
    return { json: parseJson(await readText(response, { signal, timeoutMs, maxBytes: SYNTX_JSON_MAX_BYTES })) };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") {
      return { failure: withAcceptedJob(fail(499, `SYNTX ${modality} generate was cancelled after it was accepted`, secrets), modality, "accepted") };
    }
    // The job was accepted (2xx); the answer only feeds the immediate-URL fallback.
    return { json: undefined };
  }
}

async function pollChat({ chatUuid, token, credentials, secrets, signal, modality, options }) {
  const fetchImpl = options.fetchImpl ?? defaultSyntxFetch;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? sleep;
  const timeoutMs = syntxPollTimeout(options.timeoutMs);
  const requestTimeoutMs = options.requestTimeoutMs ?? SYNTX_REQUEST_TIMEOUT_MS;
  const maxInterval = options.pollIntervalMs ?? SYNTX_POLL_INTERVAL_MS;
  let interval = Math.max(Math.floor(maxInterval * 0.4), Math.min(1000, maxInterval));
  const start = now();
  let errors = 0;
  const lost = (status, message, jobState) => ({ failure: withAcceptedJob(fail(status, message, secrets), modality, jobState) });
  while (true) {
    if (signal?.aborted) return lost(499, `SYNTX ${modality} wait was cancelled after the job was accepted`, "cancelled");
    if (now() - start > timeoutMs) return lost(HTTP_STATUS.GATEWAY_TIMEOUT, `Timed out waiting for SYNTX ${modality} media`, "poll-timeout");
    const remaining = Math.max(1, timeoutMs - (now() - start));
    let response = null;
    try {
      response = await boundedFetch(fetchImpl, syntxMessagesUrl(chatUuid), { method: "GET", headers: syntxApiHeaders(token) }, {
        signal, timeoutMs: Math.min(requestTimeoutMs, remaining), credentials,
      });
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") return lost(499, `SYNTX ${modality} wait was cancelled after the job was accepted`, "cancelled");
    }
    if (response) {
      const away = offOrigin(response);
      if (away) return lost(HTTP_STATUS.BAD_GATEWAY, `SYNTX ${modality} status check was redirected; the redirect was not followed`, "poll-lost");
      if (response.status === 401 || response.status === 403) {
        discard(response);
        return lost(response.status, `SYNTX refused the JWT while waiting for ${modality} media`, "poll-lost");
      }
      if (response.ok) {
        let json;
        try {
          json = parseJson(await readText(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining), maxBytes: SYNTX_POLL_MAX_BYTES }));
        } catch (error) {
          if (signal?.aborted || error?.name === "AbortError") return lost(499, `SYNTX ${modality} wait was cancelled after the job was accepted`, "cancelled");
        }
        if (json !== undefined) {
          errors = 0;
          const latest = latestSyntxAssistantMessage(json);
          const projection = latest ? collectSyntxCompletedMedia(latest) : null;
          if (projection?.ready) return { done: projection };
        } else {
          errors += 1;
        }
      } else {
        discard(response);
        errors += 1;
      }
    } else {
      errors += 1;
    }
    if (errors >= SYNTX_MAX_POLL_ERRORS) return lost(HTTP_STATUS.BAD_GATEWAY, `SYNTX ${modality} status checks kept failing`, "poll-lost");
    try {
      await wait(interval, signal);
    } catch {
      return lost(499, `SYNTX ${modality} wait was cancelled after the job was accepted`, "cancelled");
    }
    interval = Math.min(maxInterval, Math.floor(interval * 1.5));
  }
}

/**
 * Run one media job after uploads. Returns `{ success: true, chatUuid, text,
 * media, accounting }` or an error result (with `acceptedJob` once the
 * generate POST may have reached SYNTX).
 *
 * @param {object} job
 * @param {"image"|"video"|"audio"} job.scope - chat scope
 * @param {"design"|"video"|"audio"} job.route - generate route
 * @param {"chat_uuid"|"chat_id"} job.chatField - video uses chat_id (source)
 * @param {string} job.modality - accounting modality (image, video, tts, music)
 * @param {string} job.kindHint - object type for immediate URLs
 * @param {string[]} [job.inputUrls] - submitted reference URLs, never returned as output
 */
export async function runSyntxMediaJob(job) {
  const { scope, route, chatField, aiName, prompt, settings: providerOptions, fileUrls, audioUrl, modality, kindHint, token, credentials, secrets, signal, options = {} } = job;
  const chat = await createSyntxChat({ token, credentials, secrets, scope, title: prompt, signal, options });
  if (!chat.success) return chat;
  const payload = { [chatField]: chat.chatUuid, prompt, settings: providerOptions };
  if (fileUrls?.length) payload.file_urls = fileUrls;
  if (audioUrl) payload.audio_url = audioUrl;
  const submitted = await submitGenerate({ route, aiName, payload, token, credentials, secrets, signal, modality, options });
  if (submitted.failure) return submitted.failure;
  options.log?.debug?.("SYNTX", `${modality} job accepted`);
  const polled = await pollChat({ chatUuid: chat.chatUuid, token, credentials, secrets, signal, modality, options });
  if (polled.failure) return polled.failure;

  const inputs = new Set([...(job.inputUrls ?? []), ...(fileUrls ?? []), ...(audioUrl ? [audioUrl] : [])]);
  let media = dedupe(polled.done.media);
  if (media.length === 0) {
    media = dedupe(extractSyntxImmediateUrls(submitted.json, kindHint)).filter((item) => !inputs.has(item.url));
  }
  if (media.length === 0) {
    return withAcceptedJob(fail(HTTP_STATUS.BAD_GATEWAY, `SYNTX ${modality} job completed without a media URL`, secrets), modality, "accepted");
  }
  const safe = [];
  for (const item of media.slice(0, SYNTX_MAX_RESULTS)) {
    const url = syntxPublicUrl(item.url);
    if (!url) {
      return withAcceptedJob(fail(HTTP_STATUS.BAD_GATEWAY, `SYNTX ${modality} job returned a media URL that is not public https`, secrets), modality, "accepted");
    }
    safe.push({ objectType: item.objectType, url });
  }
  const accounting = mediaAccounting(null, SYNTX_PROVIDER_ID, modality);
  accounting.meta.chatId = chat.chatUuid;
  return { success: true, chatUuid: chat.chatUuid, text: polled.done.text, media: safe, accounting };
}
