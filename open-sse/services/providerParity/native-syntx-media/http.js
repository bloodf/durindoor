// Transport to the fixed SYNTX API origin: one bounded, abortable request
// through the selected connection's egress (proxyAwareFetch with that
// connection's proxy options), redirect refusal (the JWT is never carried to
// another host), bounded body reads, and refused-answer mapping that keeps
// only the HTTP status and a bounded Retry-After. The source quotes the
// sanitized upstream body in its errors; this module never does.
import { createErrorResult, parseRateLimitEvidence, readBoundedResponseText } from "../../../utils/error.js";
import { HTTP_STATUS } from "../../../config/runtimeConfig.js";
import { mediaAccounting } from "../../../handlers/mediaAccounting.js";
import { proxyAwareFetch } from "../../../utils/proxyFetch.js";
import { resolveCredentialProxyOptions } from "../../oauthCredentialManager.js";
import { SYNTX_API_ORIGIN, SYNTX_ERROR_MAX_BYTES, SYNTX_PROVIDER_ID } from "./config.js";

// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});

/** Default API transport: the connection's own proxy settings, never a shared account. */
export const defaultSyntxFetch = (url, init, credentials) =>
  proxyAwareFetch(url, init, resolveCredentialProxyOptions(credentials));

export const abortError = (message = "aborted") => Object.assign(new Error(message), { name: "AbortError" });
export const timeoutError = (message = "request timed out") => Object.assign(new Error(message), { name: "TimeoutError" });

/**
 * One request bounded by the caller's signal and a deadline. The wait ends on
 * either even when a transport ignores its signal; a late answer is discarded.
 * Throws an AbortError tagged `notSent` when the caller left before the send.
 */
export async function boundedFetch(fetchImpl, url, init, { signal, timeoutMs, credentials }) {
  if (signal?.aborted) throw Object.assign(abortError("aborted before send"), { notSent: true });
  const deadline = new AbortController();
  const fetchSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  let timedOut = false;
  let stopWaiting;
  const timer = setTimeout(() => {
    timedOut = true;
    deadline.abort(timeoutError());
  }, Math.max(1, timeoutMs));
  const bound = new Promise((_, rejectWait) => {
    stopWaiting = () => rejectWait(timedOut ? timeoutError() : abortError());
    fetchSignal.addEventListener("abort", stopWaiting, { once: true });
  });
  let pending;
  try {
    pending = Promise.resolve(fetchImpl(url, { ...init, redirect: "manual", signal: fetchSignal }, credentials));
  } catch (error) {
    clearTimeout(timer);
    fetchSignal.removeEventListener("abort", stopWaiting);
    bound.catch(() => {});
    throw error;
  }
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

/** Whether a failed send provably never reached SYNTX. */
export const provenUnsent = (error) =>
  error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);

/**
 * A redirect is refused and never followed with the JWT. An answer from any
 * other origin means another host may have seen the request.
 *
 * @returns {null | "redirect" | "foreign"}
 */
export function offOrigin(response) {
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    discard(response);
    return "redirect";
  }
  let answeredBy = SYNTX_API_ORIGIN;
  try {
    if (response.url) answeredBy = new URL(response.url).origin;
  } catch {
    answeredBy = null;
  }
  if (response.redirected || answeredBy !== SYNTX_API_ORIGIN) {
    discard(response);
    return "foreign";
  }
  return null;
}

/**
 * Bounded body text. Throws a TimeoutError, an AbortError, or an Error with
 * `unreadable: true`.
 */
export async function readText(response, { signal, timeoutMs, maxBytes }) {
  try {
    return await readBoundedResponseText(response, { signal, maxBytes, timeoutMs: Math.max(1, timeoutMs), throwOnTimeout: true });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError" || error?.name === "TimeoutError") throw error;
    throw Object.assign(new Error("unreadable body"), { unreadable: true });
  }
}

/** A JSON value parsed from text, or undefined. The parser's message (which quotes the body) is dropped. */
export function parseJson(text) {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

/** Accounting for a job SYNTX may have run (and may bill) whose outcome is not known. */
export function syntxAcceptedJob(modality, jobState = "accepted") {
  return { ...mediaAccounting(null, SYNTX_PROVIDER_ID, modality), costSource: "accepted-job", meta: { jobState } };
}

export const withAcceptedJob = (result, modality, jobState) => ({ ...result, acceptedJob: syntxAcceptedJob(modality, jobState) });

export const fail = (status, message, secrets) => createErrorResult(status, message, undefined, undefined, null, secrets ?? null);

/**
 * A refused (non-2xx, non-redirect) answer. Only the status and a bounded
 * Retry-After survive. The source maps no quota condition (it passes the
 * HTTP status through), so none is flagged here: 402 stays a plain 402 and
 * 429 is a rate limit with header-only reset evidence.
 */
export async function refusedAnswer(response, { signal, timeoutMs, label, secrets }) {
  try {
    await readBoundedResponseText(response, { signal, maxBytes: SYNTX_ERROR_MAX_BYTES, timeoutMs: Math.max(1, Math.min(timeoutMs, 2_000)) });
  } catch {
    discard(response);
  }
  const status = response.status;
  if (status === 401 || status === 403) {
    return fail(status, `SYNTX refused the JWT for ${label}; re-paste the Authorization Bearer token from syntx.ai`, secrets);
  }
  if (status === 429) {
    const evidence = parseRateLimitEvidence({ status: 429, headers: new Headers({ "retry-after": response.headers.get("retry-after") ?? "" }), now: Date.now() });
    const usable = evidence?.source === "retry_after" && Number.isFinite(evidence.resetAtMs) ? evidence : null;
    return createErrorResult(429, `SYNTX rate limited ${label}`, usable?.resetAtMs, undefined, usable, secrets ?? null);
  }
  const passed = status >= 400 && status < 500 ? status : HTTP_STATUS.BAD_GATEWAY;
  return fail(passed, `SYNTX ${label} failed with HTTP ${status}`, secrets);
}
