// The xAI video job envelope on the Grok CLI chat proxy: POST the job to
// `/v1/videos/generations`, read `request_id`, then GET
// `/v1/videos/{request_id}` every poll interval until `status` is "done" with
// `video.url` or "failed". See ./config.js for the source attribution.
//
// Fork deviations from xaiGrokImagineHandler.ts: the token goes only to
// https://cli-chat-proxy.grok.com (connection base URLs are ignored); each
// request is bounded on its own as well as by the job deadline; redirects are
// refused (the source used `redirect: "error"`); upstream text
// (`error.message`, `message`) never reaches an error message; a create whose
// outcome is unknown, and every accepted job not seen to fail, carries
// `acceptedJob` and is never resent; an unreadable status answer, or one about
// another job, is an unknown outcome instead of a generic error; a done job
// without a public https video URL ends at once; 429/503 status answers are
// retried a bounded number of times; the result URL is returned, never
// downloaded; usage is recorded by the gateway ledger, not saveCallLog.
import { createErrorResult } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { sleep } from "../../../handlers/imageProviders/_base.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { isNumber, isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  GROK_CLI_JOB_TIMEOUT_MS, GROK_CLI_MAX_POLLS, GROK_CLI_MAX_POLL_RETRIES, GROK_CLI_MAX_RESPONSE_BYTES,
  GROK_CLI_MAX_RETRY_DELAY_MS, GROK_CLI_POLL_INTERVAL_MS, GROK_CLI_PROVIDER_ID, GROK_CLI_REQUEST_TIMEOUT_MS,
  GROK_CLI_SUBMIT_TIMEOUT_MS, GROK_CLI_VIDEO_GENERATIONS_URL, grokCliVideoStatusUrl,
} from "./config.js";
import {
  boundedFetch, discard, grokCliPollHeaders, grokCliPublicUrl, grokCliSecrets, grokCliSubmitHeaders, grokCliToken,
  provenUnsent, readJsonObject, redirectState, refusedAnswer, retryAfterMs, unknownOutcome, withAcceptedJob,
} from "./http.js";

// Source request_id check, with a length bound.
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,256}$/;
const PASSED_POLL_STATUSES = new Set([401, 402, 403, 429]);

const abortedResult = () => createErrorResult(499, "Grok CLI video request aborted");

// null while pending; the done answer (with its public URL) once done. Throws otherwise.
function settle(answer, id) {
  if (answer.request_id !== undefined && answer.request_id !== id) throw unknownOutcome("answered about a different video job");
  const status = isString(answer.status) && answer.status.trim() ? answer.status.trim() : "pending";
  if (status === "done") {
    const url = grokCliPublicUrl(isRecord(answer.video) ? answer.video.url : null);
    if (!url) throw unknownOutcome("video job done without a usable video URL");
    return { url, answer };
  }
  if (status === "failed") throw Object.assign(new Error("Grok CLI video job failed"), { status: HTTP_STATUS.BAD_GATEWAY, jobFailed: true });
  return null;
}

async function awaitJob(id, { headers, proxyOptions, signal, deadline, pollIntervalMs, maxPolls, requestTimeoutMs, wait, now }) {
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  const url = grokCliVideoStatusUrl(id);
  let delay = pollIntervalMs;
  let retries = 0;
  let rejected = 0;
  let polls = 0;
  for (;;) {
    if (polls >= maxPolls || now() + delay > deadline) {
      throw rejected
        ? unknownOutcome(`video status check returned ${rejected}`, rejected === 429 ? 429 : 502)
        : unknownOutcome("video job did not finish in time", HTTP_STATUS.GATEWAY_TIMEOUT);
    }
    await wait(delay, signal);
    signal?.throwIfAborted();
    polls += 1;
    let response;
    try {
      response = await boundedFetch(url, { method: "GET", headers, redirect: "manual", proxyOptions }, { signal, timeoutMs: budget() });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (error?.name === "TimeoutError") throw unknownOutcome("video status check timed out", HTTP_STATUS.GATEWAY_TIMEOUT);
      throw unknownOutcome("video status check failed");
    }
    if (redirectState(response)) throw unknownOutcome("video status check was redirected");
    if (!response.ok) {
      discard(response);
      const { status } = response;
      if ((status === 429 || status === 503) && retries < GROK_CLI_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = status;
        delay = Math.min(
          GROK_CLI_MAX_RETRY_DELAY_MS,
          Math.max(retryAfterMs(response.headers.get("retry-after"), now()), pollIntervalMs * 2 ** (retries - 1))
        );
        continue;
      }
      throw unknownOutcome(`video status check returned ${status}`, PASSED_POLL_STATUSES.has(status) ? status : 502);
    }
    const answer = await readJsonObject(response, { signal, timeoutMs: budget(), maxBytes: GROK_CLI_MAX_RESPONSE_BYTES, what: "video status" });
    delay = pollIntervalMs;
    retries = 0;
    rejected = 0;
    const done = settle(answer, id);
    if (done) return done;
  }
}

/** Ledger accounting for a done job: one video, measured seconds when reported, cost unknown unless a USD receipt says otherwise. */
function doneAccounting(answer, id) {
  const accounting = mediaAccounting(answer, GROK_CLI_PROVIDER_ID, "video");
  const nativeUnits = { videos: 1 };
  const seconds = answer.video?.duration;
  if (isNumber(seconds) && Number.isFinite(seconds) && seconds >= 0) nativeUnits.videoSeconds = seconds;
  return { ...accounting, nativeUnits, meta: { ...accounting.meta, jobId: id, nativeUnitsSource: "returned-videos" } };
}

/**
 * Create one Grok Imagine video job for the selected OAuth connection and
 * follow it to its result URL. Returns `{ success: true, url, requestId,
 * accounting }`, or an error result, with `acceptedJob` when the proxy may have
 * taken (and may bill) the job. Nothing is resent and nothing is shared
 * between calls.
 */
export async function runGrokCliVideoJob({
  request,
  credentials,
  signal,
  log,
  timeoutMs = GROK_CLI_JOB_TIMEOUT_MS,
  pollIntervalMs = GROK_CLI_POLL_INTERVAL_MS,
  maxPolls = GROK_CLI_MAX_POLLS,
  submitTimeoutMs = GROK_CLI_SUBMIT_TIMEOUT_MS,
  requestTimeoutMs = GROK_CLI_REQUEST_TIMEOUT_MS,
  wait = sleep,
  now = Date.now,
}) {
  const auth = grokCliToken(credentials, now());
  if (auth.error) return createErrorResult(HTTP_STATUS.UNAUTHORIZED, auth.error);
  const { token } = auth;
  if (signal?.aborted) return abortedResult();
  const secrets = grokCliSecrets(credentials);
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  const deadline = now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - now());

  let response;
  try {
    response = await boundedFetch(GROK_CLI_VIDEO_GENERATIONS_URL, {
      method: "POST",
      headers: grokCliSubmitHeaders(token),
      body: JSON.stringify(request),
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs: Math.min(submitTimeoutMs, remaining()) });
  } catch (error) {
    const unsent = provenUnsent(error);
    if (signal?.aborted || error?.name === "AbortError") return unsent ? abortedResult() : withAcceptedJob(abortedResult(), "submit-unknown");
    if (unsent) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Grok CLI video create could not connect");
    const timedOut = error?.name === "TimeoutError";
    return withAcceptedJob(createErrorResult(
      timedOut ? HTTP_STATUS.GATEWAY_TIMEOUT : HTTP_STATUS.BAD_GATEWAY,
      `Grok CLI video create ${timedOut ? "timed out" : "was interrupted"}; the job was not resubmitted and whether it was accepted is unknown`
    ), "submit-unknown");
  }

  const redirect = redirectState(response);
  if (redirect?.refused) {
    log?.debug?.("GROK_CLI", "video create redirect refused");
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Grok CLI video create redirect refused");
  }
  if (redirect?.foreign) return withAcceptedJob(createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Grok CLI video create was redirected"), "submit-unknown");
  if (!response.ok) {
    return refusedAnswer(response, { signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), secrets, now });
  }

  try {
    const accepted = await readJsonObject(response, {
      signal, timeoutMs: Math.min(requestTimeoutMs, remaining()), maxBytes: GROK_CLI_MAX_RESPONSE_BYTES, what: "video create answer",
    });
    const id = isString(accepted.request_id) && REQUEST_ID_RE.test(accepted.request_id) ? accepted.request_id : null;
    if (!id) throw unknownOutcome("did not return a usable video request_id");
    const done = await awaitJob(id, {
      headers: grokCliPollHeaders(token), proxyOptions, signal, deadline, pollIntervalMs, maxPolls, requestTimeoutMs, wait, now,
    });
    return { success: true, url: done.url, requestId: id, accounting: doneAccounting(done.answer, id) };
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") return withAcceptedJob(abortedResult(), "accepted");
    const status = Number(error?.status);
    const failed = createErrorResult(
      Number.isInteger(status) && status >= 400 && status <= 599 ? status : HTTP_STATUS.BAD_GATEWAY,
      error?.jobOutcomeUnknown || error?.jobFailed ? error.message : "Invalid response from Grok CLI",
      undefined, undefined, null, secrets
    );
    // A job the proxy reports as failed is an ordinary failure; anything else may still bill.
    return error?.jobFailed ? failed : withAcceptedJob(failed, "accepted");
  }
}
