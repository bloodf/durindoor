// Segmind video request: one bounded synchronous POST that answers with the
// video bytes, a bounded body read, and accepted-job accounting.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/utils/segmindClient.ts (segmindRequest: POST {baseUrl}/{model}
// with `Content-Type: application/json` and `x-api-key: <token>`, the JSON
// body, raw media bytes and their content type on success, a failure result
// carrying the upstream status otherwise, 502 on a transport error) and
// open-sse/handlers/videoGeneration/providers/segmind.ts
// (handleSegmindVideoGeneration: token = apiKey || accessToken,
// `{ created, data: [{ b64_json, format: "mp4" }] }`).
//
// Fork deviations: the request and the body read share one deadline and abort
// on the caller's signal; redirects are refused and an answer from any other
// origin is discarded; the body is size bounded; the upstream error text is
// never returned (the source returned it sanitized), only the status, and a
// spent balance is read from it without quoting it. The source answered any
// 200 body as an MP4; here the body must be an MP4 (`ftyp` box first) and a
// JSON, text or image answer is an unusable completed request. A request
// whose outcome is unknown, or that completed without a usable video, carries
// `acceptedJob` and is never resent. A missing key is a local 401 (the source
// sent an empty `x-api-key`). Segmind has no job id or cancel call, so an
// abort after the send only stops this client.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  SEGMIND_AUTH_HEADER,
  SEGMIND_ORIGIN,
  SEGMIND_PROVIDER_ID,
  SEGMIND_VIDEO_MAX_BYTES,
  SEGMIND_VIDEO_TIMEOUT_MS,
} from "./config.js";

const MAX_ERROR_BYTES = 16 * 1024;
const ERROR_READ_TIMEOUT_MS = 5_000;
// Segmind's documented insufficient-credit answer, matched without quoting it.
const QUOTA_RE = /not enough credits?|insufficient (?:balance|credits?|funds)|out of credits?/i;
// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const NON_VIDEO_TYPE_RE = /^(?:application\/(?:json|problem\+json|xml)|text\/|image\/|audio\/)/i;

const discard = (response) => void response?.body?.cancel?.().catch(() => {});
const abortedResult = () => createErrorResult(499, "Segmind video request aborted");
const timeoutError = () => Object.assign(new Error("Segmind video request timed out"), { name: "TimeoutError" });

/** Accounting for a request Segmind may have run (and may bill) whose outcome is not known. */
export function segmindVideoAcceptedJob(jobState = "accepted") {
  return { ...mediaAccounting(null, SEGMIND_PROVIDER_ID, "video"), costSource: "accepted-job", meta: { jobState } };
}
const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: segmindVideoAcceptedJob(jobState) });

/** The key of the selected connection (apiKey, else accessToken), or "" when missing or unusable as a header. */
export function segmindVideoToken(credentials) {
  const value = credentials?.apiKey || credentials?.accessToken;
  return isString(value) && value.trim() && !/[\r\n\0]/.test(value) ? value.trim() : "";
}

/** Whether `bytes` start with an ISO BMFF `ftyp` box (MP4 / MOV family). */
export function isSegmindMp4(bytes) {
  return bytes?.byteLength >= 12 && Buffer.from(bytes.subarray(4, 8)).toString("latin1") === "ftyp";
}

// Waits on `promise` until the deadline or the caller's abort, whichever is first.
function bounded(promise, { signal, deadline, now }) {
  let timer;
  let onAbort;
  const stop = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError()), Math.max(1, deadline - now()));
    onAbort = () => reject(signal.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" }));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([promise, stop]).finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    stop.catch(() => {});
  });
}

/** Read the whole body as bytes, refusing more than `maxBytes`. */
async function readVideoBytes(response, { signal, deadline, now, maxBytes }) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    discard(response);
    throw Object.assign(new Error("too large"), { tooLarge: true });
  }
  const reader = response.body?.getReader?.();
  if (!reader) return new Uint8Array(await bounded(response.arrayBuffer(), { signal, deadline, now }));
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await bounded(reader.read(), { signal, deadline, now });
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw Object.assign(new Error("too large"), { tooLarge: true });
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks, total);
}

/**
 * A refused (non-2xx, non-redirect) answer. Only the status, a quota match
 * and a bounded Retry-After are kept. A 5xx may come after Segmind ran the
 * model, so its outcome is unknown and it carries `acceptedJob`.
 */
async function refusedAnswer(response, { signal, secrets }) {
  const { status } = response;
  if (status >= 500) {
    discard(response);
    return withAcceptedJob(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Segmind video request failed with ${status}; whether it ran is unknown`),
      "submit-unknown"
    );
  }
  let quota = status === 402;
  if (!quota && [403, 406, 429].includes(status)) {
    try {
      quota = QUOTA_RE.test(await readBoundedResponseText(response, { signal, maxBytes: MAX_ERROR_BYTES, timeoutMs: ERROR_READ_TIMEOUT_MS }));
    } catch {
      discard(response);
    }
  } else {
    discard(response);
  }
  if (quota) {
    // The credit is spent on this connection only, until its owner tops up.
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, "Segmind refused video generation: the account has no credits left", undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401 || status === 403) {
    return createErrorResult(401, `Segmind refused the API key for video generation (${status})`, undefined, undefined, null, secrets);
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, "Segmind rate limited video generation", usable?.resetAtMs, undefined, usable, secrets);
  }
  if (status === 404) return createErrorResult(404, "Segmind has no such video model", undefined, undefined, null, secrets);
  if (status === 400 || status === 422) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Segmind refused the video input (${status})`, undefined, undefined, null, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `Segmind refused the video request with ${status}`, undefined, undefined, null, secrets);
}

/**
 * Run one Segmind video request for the selected connection.
 *
 * Results use the media core shape: `{ success: true, base64, contentType,
 * bytes, accounting }`, or an error result from createErrorResult, with
 * `acceptedJob` when Segmind may have run (and may bill) the request.
 *
 * @param {object} options
 * @param {{ url: string, body: object }} options.request - from buildSegmindVideoRequest
 * @param {object} options.credentials - the selected `segmind` connection
 */
export async function runSegmindVideoJob({
  request,
  credentials,
  signal,
  log,
  timeoutMs = SEGMIND_VIDEO_TIMEOUT_MS,
  maxBytes = SEGMIND_VIDEO_MAX_BYTES,
  now = Date.now,
}) {
  if (signal?.aborted) return abortedResult();
  const token = segmindVideoToken(credentials);
  if (!token) return createErrorResult(401, "Segmind API key is required");
  if (new URL(request.url).origin !== SEGMIND_ORIGIN) return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Invalid Segmind URL");
  const secrets = { apiKey: credentials?.apiKey, accessToken: credentials?.accessToken, token };
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const deadline = now() + timeoutMs;

  // The fetch signal ends at the deadline or the caller's abort; the wait for
  // headers ends on either even when a transport ignores its signal.
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(timeoutError()), Math.max(1, timeoutMs));
  const fetchSignal = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
  let response;
  try {
    const pending = fetch(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", [SEGMIND_AUTH_HEADER]: token },
      body: JSON.stringify(request.body),
      redirect: "manual",
      signal: fetchSignal,
      proxyOptions,
    });
    try {
      response = await bounded(pending, { signal: fetchSignal, deadline, now });
    } catch (error) {
      pending.then(discard, () => {});
      throw error;
    }
  } catch (error) {
    clearTimeout(timer);
    // Whatever ended the wait, the socket is closed too.
    if (!stop.signal.aborted) stop.abort(error);
    const unsent = PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);
    if (signal?.aborted) return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Segmind video request could not connect");
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `Segmind video request ${timedOut ? "timed out" : "was interrupted"}; whether it ran is unknown`
    ), "submit-unknown");
  }

  try {
    // A redirect is refused, never followed with the key. Nothing ran.
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      discard(response);
      log?.debug?.("SEGMIND_VIDEO", "video request redirect refused");
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Segmind video request redirect refused");
    }
    let answeredBy = SEGMIND_ORIGIN;
    try {
      if (response.url) answeredBy = new URL(response.url).origin;
    } catch {
      answeredBy = null;
    }
    if (response.redirected || answeredBy !== SEGMIND_ORIGIN) {
      discard(response);
      return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Segmind video request was redirected"), "submit-unknown");
    }
    if (!response.ok) return await refusedAnswer(response, { signal, secrets });

    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (NON_VIDEO_TYPE_RE.test(contentType)) {
      discard(response);
      return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Segmind returned no video"), "completed-unusable");
    }
    let bytes;
    try {
      bytes = await readVideoBytes(response, { signal: fetchSignal, deadline, now, maxBytes });
    } catch (error) {
      if (!stop.signal.aborted) stop.abort(error);
      if (signal?.aborted) return withAcceptedJob(abortedResult(), "accepted");
      if (error?.tooLarge) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Segmind video is larger than this gateway accepts"), "completed-unusable");
      const timedOut = error?.name === "TimeoutError";
      return withAcceptedJob(createErrorResult(
        timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
        `Segmind video body ${timedOut ? "timed out" : "could not be read"}`
      ), "accepted");
    }
    if (!isSegmindMp4(bytes)) {
      return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Segmind returned a body that is not an MP4 video"), "completed-unusable");
    }
    return {
      success: true,
      base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64"),
      contentType: contentType || "video/mp4",
      bytes: bytes.byteLength,
      accounting: mediaAccounting(null, SEGMIND_PROVIDER_ID, "video"),
    };
  } finally {
    clearTimeout(timer);
  }
}
