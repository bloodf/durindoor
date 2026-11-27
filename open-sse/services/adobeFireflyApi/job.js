// Adobe Firefly Services async job observation: read the accepted job, poll its
// status on the fixed API origin within a bound, and return the image URLs.
//
// Contract: AdobeDocs/ffs-firefly-api at 1027f559cdb1509a61b34e2f2da9618ec431f2cb,
// static/firefly-api.json (AsyncAcceptResponseV3, JobResponse, JobPollPayload,
// JobSucceededPayload, PublicBinary-Output; GET /v3/status/{jobId}; PUT
// /v3/cancel/{jobId}) and src/pages/guides/how-tos/using-async-apis.md.
//
// The submit answer's statusUrl and cancelUrl are never fetched: the status
// and cancel URLs are built from a validated job id on the fixed origin, so
// credentials cannot be steered to another host. Redirects are refused, bodies
// are size and time bounded, and upstream text never reaches an error message.
// Once the submit is accepted, anything short of a job failure Adobe reports
// is an unknown outcome, so the gateway does not resubmit a job that may bill.
import { jobOutcomeUnknown, readJobBody, sleep } from "../../handlers/imageProviders/_base.js";
import {
  ADOBE_FIREFLY_API_ORIGIN,
  adobeFireflyCancelUrl,
  adobeFireflyStatusUrl,
} from "../../providers/private/adobe-firefly-api.js";
import { defaultAdobeTokenCache } from "./auth.js";
import { resolveCredentialProxyOptions } from "../oauthCredentialManager.js";
import { readBoundedResponseText } from "../../utils/error.js";
import { isRecord, isString } from "../../../src/shared/utils/typeChecks.js";

export const ADOBE_FIREFLY_POLL_INTERVAL_MS = 2_000;
export const ADOBE_FIREFLY_POLL_TIMEOUT_MS = 300_000;
export const ADOBE_FIREFLY_REQUEST_TIMEOUT_MS = 30_000;
export const ADOBE_FIREFLY_CANCEL_TIMEOUT_MS = 5_000;
export const ADOBE_FIREFLY_MAX_POLL_RETRIES = 5;
export const ADOBE_FIREFLY_MAX_RETRY_DELAY_MS = 30_000;
export const ADOBE_FIREFLY_MAX_IMAGES = 4;

const MAX_JSON_BYTES = 64 * 1024;
// PublicBinaryOutputV3.url maxLength.
const MAX_URL_LENGTH = 2083;
// Documented ids look like `urn:ff:jobs:eso851211:<uuid>`.
const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/;
const PENDING_STATUSES = new Set(["pending", "running", "cancel_pending"]);
// ColligoErrorCodeAsyncV3 codes that may be repeated, with their HTTP status.
const FAILURE_STATUS = new Map([
  ["validation_error", 422], ["bad_request", 422], ["invalid_content_type", 422], ["empty_input_body", 422],
  ["timeout_error", 504], ["rate_limited", 429], ["access_error", 403], ["runtime_error", 502],
]);
const PASSED_POLL_STATUSES = new Set([401, 403, 429]);

const unknownOutcome = (what, status = 502) => jobOutcomeUnknown(`Adobe Firefly ${what}`, status);
const reported = (message, status) => Object.assign(new Error(`Adobe Firefly ${message}`), { status });

// Delta-seconds or HTTP-date, in milliseconds.
function retryAfterMs(value, now) {
  const text = value?.trim();
  if (!text) return 0;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);
  const date = Date.parse(text);
  return Number.isNaN(date) ? 0 : Math.max(0, date - now);
}

async function readJson(response, { signal, timeoutMs }) {
  const text = await readJobBody(
    () => readBoundedResponseText(response, { signal, maxBytes: MAX_JSON_BYTES, timeoutMs, throwOnTimeout: true }),
    signal
  );
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    // The parser's message quotes the body, so it is dropped.
  }
  if (!isRecord(value)) throw unknownOutcome("returned an unreadable job response");
  return value;
}

// The running example in the async guide reports the bare uuid of a urn id.
const sameJob = (reportedId, id) => reportedId === id || id.endsWith(`:${reportedId}`);

function imageUrl(output) {
  const raw = isRecord(output) && isRecord(output.image) ? output.image.url : null;
  if (!isString(raw) || raw.length > MAX_URL_LENGTH) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
}

// null while pending; the image URLs once succeeded. Throws otherwise.
function settle(job, expectedCount) {
  if (PENDING_STATUSES.has(job.status)) return null;
  if (job.status === "succeeded") {
    const outputs = isRecord(job.result) && Array.isArray(job.result.outputs) ? job.result.outputs : [];
    const urls = outputs.map(imageUrl);
    if (urls.length === 0 || urls.length > expectedCount || urls.includes(null)) {
      throw unknownOutcome("job succeeded without a usable image result");
    }
    return urls;
  }
  if (job.status === "failed") {
    const known = FAILURE_STATUS.has(job.error_code);
    throw reported(`image job failed: ${known ? job.error_code : "unknown reason"}`, known ? FAILURE_STATUS.get(job.error_code) : 502);
  }
  if (job.status === "cancelled") throw reported("image job was cancelled", 502);
  if (job.status === "timeout") throw reported("image job timed out upstream", 504);
  throw unknownOutcome("returned an unknown job status");
}

/**
 * Follow one accepted generate-async submit to its image URLs.
 *
 * The token, client ID, proxy and job id are local to this call, so concurrent
 * accounts share no state. A status 401 with a minted token drops it from the
 * cache and mints one more for this credential, once per job.
 *
 * @param {Response} submitted - the 2xx answer to POST /v3/images/generate-async
 * @param {object} options
 * @param {{ credential: object, clientId: string, token: string }} options.auth
 * @returns {Promise<string[]>}
 */
export async function awaitAdobeFireflyImages(submitted, {
  auth,
  credentials,
  count,
  signal,
  cache = defaultAdobeTokenCache,
  pollIntervalMs = ADOBE_FIREFLY_POLL_INTERVAL_MS,
  timeoutMs = ADOBE_FIREFLY_POLL_TIMEOUT_MS,
  requestTimeoutMs = ADOBE_FIREFLY_REQUEST_TIMEOUT_MS,
  cancelTimeoutMs = ADOBE_FIREFLY_CANCEL_TIMEOUT_MS,
  wait = sleep,
  now = Date.now,
}) {
  const deadline = now() + timeoutMs;
  const budget = () => Math.max(1, Math.min(requestTimeoutMs, deadline - now()));
  const proxyOptions = resolveCredentialProxyOptions(credentials);
  let token = auth.token;
  const headers = () => ({ Authorization: `Bearer ${token}`, "x-api-key": auth.clientId, Accept: "application/json" });

  // The submit went to the fixed origin. A followed redirect means another host
  // saw it, so the job and the token are both in doubt.
  let submittedOrigin = ADOBE_FIREFLY_API_ORIGIN;
  try {
    if (submitted.url) submittedOrigin = new URL(submitted.url).origin;
  } catch {
    submittedOrigin = null;
  }
  if (submitted.redirected || submittedOrigin !== ADOBE_FIREFLY_API_ORIGIN) {
    void submitted.body?.cancel().catch(() => {});
    if (auth.credential.mode === "client_credentials") cache.invalidate(auth.credential, token);
    throw unknownOutcome("submit was redirected");
  }

  const accepted = await readJson(submitted, { signal, timeoutMs: budget() });
  const id = accepted.jobId;
  if (!isString(id) || !JOB_ID_RE.test(id)) throw unknownOutcome("did not return a usable job id");
  const statusUrl = adobeFireflyStatusUrl(id);

  // Best effort, bounded, on the fixed origin. It never changes the outcome.
  const cancelJob = async () => {
    try {
      const response = await fetch(adobeFireflyCancelUrl(id), {
        method: "PUT",
        headers: headers(),
        redirect: "error",
        signal: AbortSignal.timeout(cancelTimeoutMs),
        proxyOptions,
      });
      void response.body?.cancel().catch(() => {});
    } catch {
      // Ignored: the job is already recorded as an unknown outcome.
    }
  };
  const abandon = async (error) => {
    await cancelJob();
    throw error;
  };

  let delay = pollIntervalMs;
  let retries = 0;
  let rejected = 0;
  let reminted = false;
  let urls = null;

  while (!urls) {
    if (now() + delay > deadline) {
      return abandon(rejected
        ? unknownOutcome(`status check returned ${rejected}`, rejected === 429 ? 429 : 502)
        : unknownOutcome("image job did not finish in time", 504));
    }
    try {
      await wait(delay, signal);
      signal?.throwIfAborted();
    } catch (error) {
      return abandon(error);
    }
    const requestTimeout = AbortSignal.timeout(budget());
    let response;
    try {
      response = await fetch(statusUrl, {
        method: "GET",
        headers: headers(),
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, requestTimeout]) : requestTimeout,
        proxyOptions,
      });
    } catch {
      if (signal?.aborted) return abandon(signal.reason);
      if (requestTimeout.aborted) throw unknownOutcome("status check timed out", 504);
      // A transport error's text can describe the request, so it is not repeated.
      throw unknownOutcome("status check failed");
    }
    if (signal?.aborted) {
      void response.body?.cancel().catch(() => {});
      return abandon(signal.reason);
    }

    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      const { status } = response;
      if (status === 401 && !reminted && auth.credential.mode === "client_credentials") {
        reminted = true;
        cache.invalidate(auth.credential, token);
        try {
          token = await cache.get(auth.credential, { credentials, signal });
        } catch (error) {
          if (signal?.aborted) return abandon(signal.reason);
          throw unknownOutcome("status check returned 401", 401);
        }
        delay = pollIntervalMs;
        continue;
      }
      if (status === 401 && auth.credential.mode === "client_credentials") cache.invalidate(auth.credential, token);
      if ((status === 429 || status === 503) && retries < ADOBE_FIREFLY_MAX_POLL_RETRIES) {
        retries += 1;
        rejected = status;
        delay = Math.min(
          ADOBE_FIREFLY_MAX_RETRY_DELAY_MS,
          Math.max(retryAfterMs(response.headers.get("retry-after"), now()), pollIntervalMs * 2 ** (retries - 1))
        );
        continue;
      }
      throw unknownOutcome(`status check returned ${status}`, PASSED_POLL_STATUSES.has(status) ? status : 502);
    }

    let job;
    try {
      job = await readJson(response, { signal, timeoutMs: budget() });
    } catch (error) {
      if (signal?.aborted) return abandon(signal.reason);
      throw error;
    }
    if (!isString(job.jobId) || !sameJob(job.jobId, id)) throw unknownOutcome("answered about a different job");
    delay = pollIntervalMs;
    retries = 0;
    rejected = 0;
    urls = settle(job, count);
  }
  return urls;
}
