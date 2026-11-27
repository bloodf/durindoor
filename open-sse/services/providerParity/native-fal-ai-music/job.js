// fal queue job for music: one bounded submit, bounded status polling, one
// result read, and accepted-job accounting.
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/mediaGeneration/fal.ts (runFalQueue with native = true:
// a missing key is a local 401 before anything is sent; POST
// `https://queue.fal.run/{endpoint}` with `Authorization: Key <key>` and
// `Content-Type: application/json`; an accept body without `request_id` is
// the result itself; `status_url`/`response_url` pinned to the queue, else
// `{queue}/requests/{id}/status` and `{queue}/requests/{id}`; GET status with
// the key until COMPLETED, IN_QUEUE/IN_PROGRESS keep waiting at most 1 s
// apart, any other status fails; GET the result on COMPLETED; the whole job
// is bounded by one deadline and aborts on the caller's signal) and
// open-sse/handlers/fal/client.ts (POSTs are dispatched once; upstream error
// bodies are never surfaced because they can hold signed URLs, inputs and
// credentials).
//
// Fork deviations: the source returned up to 500 characters of the upstream
// error body; here only the HTTP status (and, for 422, the names of the
// rejected input fields, when of a safe shape) is kept. A submit whose outcome
// is unknown (5xx, timeout, reset after send, abort after send, a redirect
// that was followed) is reported with `acceptedJob` and never resent. Every
// accepted request that does not return audio (poll or result failure, an
// unknown status, the deadline, an abort) is also reported with `acceptedJob`,
// because fal does not report whether it bills. Redirects are refused. A
// balance or lock refusal is reported as 402 with `quotaExhausted`. The source
// never cancels an accepted request, so neither does this client.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { FAL_MUSIC_PROVIDER_ID, FAL_QUEUE_ORIGIN } from "./config.js";
import { discard, falAuthHeader, falRead, falTrackingUrl, isFalRequestId, readJsonObject } from "./transport.js";

// Source poll cadence (at most 1 s apart), plus per-request gateway bounds.
export const FAL_MUSIC_POLL_INTERVAL_MS = 1_000;
export const FAL_MUSIC_TIMEOUT_MS = 300_000;
export const FAL_MUSIC_SUBMIT_TIMEOUT_MS = 30_000;
export const FAL_MUSIC_REQUEST_TIMEOUT_MS = 30_000;
const MAX_ACCEPT_BYTES = 64 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const MAX_STATUS_BYTES = 256 * 1024;
export const FAL_MUSIC_MAX_RESULT_BYTES = 1024 * 1024;
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const QUOTA_RE = /exhausted balance|insufficient (?:balance|credits?|funds)|user is locked|top up your balance/i;
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const PENDING = new Set(["IN_QUEUE", "IN_PROGRESS"]);

/** The selected connection's key: `apiKey`, else `accessToken` (source getToken). */
export function falMusicToken(credentials) {
  const raw = credentials?.apiKey || credentials?.accessToken || "";
  return isString(raw) ? raw.trim() : "";
}

/** Accounting for a request fal may have taken (and may bill) whose outcome is not known. */
export function falMusicAcceptedJob(jobState = "accepted") {
  return { ...mediaAccounting(null, FAL_MUSIC_PROVIDER_ID, "music"), costSource: "accepted-job", meta: { jobState } };
}

const withAcceptedJob = (result, jobState) => ({ ...result, acceptedJob: falMusicAcceptedJob(jobState) });
const abortedResult = () => createErrorResult(499, "fal music request aborted");
const lost = (message, status = HTTP_STATUS.BAD_GATEWAY) => Object.assign(new Error(message), { status, jobOutcomeUnknown: true });

// One POST bounded by the caller's signal and a deadline. The wait ends on
// either even when a transport ignores its signal; a late answer is discarded.
async function sendSubmit(url, init, { signal, timeoutMs }) {
  if (signal?.aborted) throw Object.assign(new Error("aborted before submit"), { name: "AbortError", notSent: true });
  const deadline = new AbortController();
  const fetchSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  const timeoutError = () => Object.assign(new Error("submit timed out"), { name: "TimeoutError" });
  let timedOut = false;
  let stopWaiting;
  const timer = setTimeout(() => {
    timedOut = true;
    deadline.abort(timeoutError());
  }, timeoutMs);
  const bound = new Promise((_, rejectWait) => {
    stopWaiting = () => rejectWait(timedOut ? timeoutError() : fetchSignal.reason);
    fetchSignal.addEventListener("abort", stopWaiting, { once: true });
  });
  const pending = fetch(url, { ...init, signal: fetchSignal });
  let delivered = null;
  try {
    delivered = await Promise.race([pending, bound]);
    return delivered;
  } catch (error) {
    if (timedOut) throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    fetchSignal.removeEventListener("abort", stopWaiting);
    bound.catch(() => {});
    if (!delivered) pending.then(discard, () => {});
  }
}

// A refused (non-2xx, non-redirect) submit. fal refuses these before a request
// exists, except a 5xx, whose outcome is unknown. Only safe-shaped facts are kept.
async function refusedSubmit(response, { signal, timeoutMs, secrets }) {
  const { status } = response;
  let payload = null;
  try {
    payload = JSON.parse(await readBoundedResponseText(response, { signal, maxBytes: MAX_ERROR_BYTES, timeoutMs }));
  } catch {
    discard(response);
  }
  if (status >= 500) {
    return withAcceptedJob(
      createErrorResult(HTTP_STATUS.BAD_GATEWAY, `fal music submit failed with ${status}; whether a request was queued is unknown`),
      "submit-unknown"
    );
  }
  const detail = isRecord(payload) ? payload.detail : undefined;
  if (status === 402 || (status === 403 && isString(detail) && QUOTA_RE.test(detail))) {
    const failed = createErrorResult(HTTP_STATUS.PAYMENT_REQUIRED, "fal refused music generation: the account balance is exhausted or locked", undefined, undefined, null, secrets);
    return { ...failed, quotaExhausted: true };
  }
  if (status === 401 || status === 403) return createErrorResult(status, `fal refused the credential for music generation (${status})`, undefined, undefined, null, secrets);
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, "fal rate limited music generation", usable?.resetAtMs, undefined, usable, secrets);
  }
  if (status === 422) {
    const fields = (Array.isArray(detail) ? detail : [])
      .map((item) => (isRecord(item) && Array.isArray(item.loc) ? item.loc.at(-1) : null))
      .filter((field) => isString(field) && FIELD_RE.test(field));
    const suffix = fields.length ? `: ${[...new Set(fields)].slice(0, 8).join(", ")}` : "";
    return createErrorResult(422, `fal rejected the music input${suffix}`, undefined, undefined, null, secrets);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return createErrorResult(passed, `fal refused the music request with ${status}`, undefined, undefined, null, secrets);
}

/** Follow one queued request to its result payload within the job deadline. */
async function awaitResult({ statusUrl, responseUrl, read, deadline, pollIntervalMs, wait, now, signal }) {
  const budget = () => Math.max(1, deadline - now());
  for (;;) {
    let response;
    try {
      response = await falRead(statusUrl, read);
    } catch (error) {
      if (signal?.aborted) throw error;
      throw lost(error?.name === "TimeoutError" ? "fal music status check timed out" : "fal music status check failed",
        error?.name === "TimeoutError" ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY);
    }
    if (!response.ok) {
      discard(response);
      throw lost(`fal music status check returned ${response.status}`, [401, 403, 429].includes(response.status) ? response.status : HTTP_STATUS.BAD_GATEWAY);
    }
    const state = await readJsonObject(response, { signal, timeoutMs: budget(), maxBytes: MAX_STATUS_BYTES });
    if (!state) throw lost("fal music status check returned an unreadable body");
    if (state.status === "COMPLETED") break;
    if (!PENDING.has(state.status)) {
      const shown = isString(state.status) && /^[A-Z_]{1,32}$/.test(state.status) ? state.status : "unknown";
      throw lost(`fal music request ended with status ${shown}`);
    }
    const delay = Math.min(pollIntervalMs, Math.max(100, deadline - now()));
    if (now() + delay >= deadline) throw lost("fal music request did not finish in time", HTTP_STATUS.GATEWAY_TIMEOUT);
    await wait(delay, signal);
  }
  let response;
  try {
    response = await falRead(responseUrl, read);
  } catch (error) {
    if (signal?.aborted) throw error;
    throw lost("fal music result read failed");
  }
  if (!response.ok) {
    discard(response);
    throw lost(`fal music result returned ${response.status}`, response.status === 422 ? 422 : HTTP_STATUS.BAD_GATEWAY);
  }
  const output = await readJsonObject(response, { signal, timeoutMs: budget(), maxBytes: read.maxResultBytes });
  if (!output) throw lost("fal music result was unreadable");
  return output;
}

/**
 * Submit one fal queue request for the selected connection and follow it to
 * its result payload.
 *
 * Results use the media core shape: `{ success: true, output, requestId, accounting }`,
 * or an error result from createErrorResult, with `acceptedJob` when fal may
 * have taken (and may bill) the request. Nothing is resent, and nothing is
 * shared between calls: the key, request id and proxy belong to this call.
 *
 * @param {object} options
 * @param {string} options.endpoint - a validated fal endpoint id (`fal-ai/ace-step`)
 * @param {object} options.request - the validated submit body
 * @param {object} options.credentials - the selected `fal-ai` connection
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.deadline] - epoch ms the whole job must end by (default now + FAL_MUSIC_TIMEOUT_MS)
 */
export async function runFalMusicJob({
  endpoint,
  request,
  credentials,
  signal,
  log,
  deadline,
  submitTimeoutMs = FAL_MUSIC_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = FAL_MUSIC_REQUEST_TIMEOUT_MS,
  pollIntervalMs = FAL_MUSIC_POLL_INTERVAL_MS,
  maxResultBytes = FAL_MUSIC_MAX_RESULT_BYTES,
  wait = sleep,
  now = Date.now,
}) {
  if (signal?.aborted) return abortedResult();
  const token = falMusicToken(credentials);
  if (!token) return createErrorResult(401, "Fal API key is required");
  const secrets = { apiKey: credentials?.apiKey, accessToken: credentials?.accessToken };
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const end = Number.isFinite(deadline) ? deadline : now() + FAL_MUSIC_TIMEOUT_MS;
  const remaining = () => Math.max(1, end - now());
  const queueUrl = `${FAL_QUEUE_ORIGIN}/${endpoint}`;

  let response;
  try {
    response = await sendSubmit(queueUrl, {
      method: "POST",
      headers: { Authorization: falAuthHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify(request),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs: Math.min(submitTimeoutMs, remaining()) });
  } catch (error) {
    const unsent = error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);
    if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "fal music submit could not connect");
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `fal music submit ${timedOut ? "timed out" : "was interrupted"}; whether it was queued is unknown`
    ), "submit-unknown");
  }

  // A redirect is refused, never followed with the key. Nothing was queued.
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    discard(response);
    log?.debug?.("FAL_MUSIC", "music submit redirect refused");
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "fal music submit redirect refused");
  }
  let answeredBy = FAL_QUEUE_ORIGIN;
  try {
    if (response.url) answeredBy = new URL(response.url).origin;
  } catch {
    answeredBy = null;
  }
  if (response.redirected || answeredBy !== FAL_QUEUE_ORIGIN) {
    discard(response);
    return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "fal music submit was redirected"), "submit-unknown");
  }
  if (!response.ok) return refusedSubmit(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), secrets });

  const read = {
    token, signal, proxyOptions, wait, now, maxResultBytes,
    timeoutMs: () => Math.min(requestTimeoutMs, remaining()),
  };
  try {
    const accepted = await readJsonObject(response, { signal, timeoutMs: read.timeoutMs(), maxBytes: Math.max(MAX_ACCEPT_BYTES, maxResultBytes) });
    if (!accepted) throw lost("fal music submit returned an unreadable body");
    // Source: an accept body without `request_id` is the finished result.
    if (accepted.request_id === undefined) {
      return { success: true, output: accepted, requestId: null, accounting: mediaAccounting(null, FAL_MUSIC_PROVIDER_ID, "music") };
    }
    const requestId = accepted.request_id;
    if (!isFalRequestId(requestId)) throw lost("fal music submit returned an unusable request id");
    const statusUrl = falTrackingUrl(accepted.status_url, requestId, "status", `${queueUrl}/requests/${requestId}/status`);
    const responseUrl = falTrackingUrl(accepted.response_url, requestId, "result", `${queueUrl}/requests/${requestId}`);
    if (!statusUrl || !responseUrl) throw lost("fal music submit returned a tracking URL outside the fal queue");
    const output = await awaitResult({ statusUrl, responseUrl, read, deadline: end, pollIntervalMs, wait, now, signal });
    return { success: true, output, requestId, accounting: mediaAccounting(null, FAL_MUSIC_PROVIDER_ID, "music") };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "accepted");
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown ? error.message : "Invalid response from fal",
      undefined, undefined, null, secrets
    );
    return withAcceptedJob(failed, "accepted");
  }
}
