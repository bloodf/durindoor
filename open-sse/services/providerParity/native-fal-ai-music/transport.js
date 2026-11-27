// Bounded, fixed-origin fal reads (queue status, queue result, catalog).
//
// Ported from OmniRoute at c71f0065a7efe9230ec23b96a12253b050c4d7ad (MIT):
// open-sse/handlers/fal/client.ts (validateFalTarget: only api.fal.ai, fal.run
// and queue.fal.run, no userinfo; FalClient.request: `redirect: "error"`,
// `Authorization: Key <token>`, a deadline, reads retried at most twice on 429
// or 503 when Retry-After is at most 5 s; falTrackingUrl: queue URLs must stay
// on queue.fal.run and name this request id).
//
// Fork deviations: this adapter never contacts fal.run; status and result URLs
// must also end in `/requests/{id}/status` and `/requests/{id}`; response
// bodies are size bounded; the connection's proxy options are honored.
import { readBoundedResponseText } from "../../../utils/error.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import { FAL_CATALOG_ORIGIN, FAL_QUEUE_ORIGIN } from "./config.js";

const ALLOWED_ORIGINS = new Set([FAL_QUEUE_ORIGIN, FAL_CATALOG_ORIGIN]);
export const FAL_MUSIC_MAX_READ_RETRIES = 2;
const MAX_RETRY_AFTER_S = 5;
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{7,127}$/;

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});
export const falAuthHeader = (token) => `Key ${token}`;

/** Whether `value` has the shape of a fal queue request id. */
export function isFalRequestId(value) {
  return isString(value) && REQUEST_ID_RE.test(value);
}

/** `url` if it is on a fal origin this adapter may send the key to, else throws. */
export function assertFalTarget(url) {
  const target = new URL(url);
  if (!ALLOWED_ORIGINS.has(target.origin) || target.username || target.password || target.hash) {
    throw Object.assign(new Error("Invalid fal request URL"), { status: 502 });
  }
  return target.toString();
}

/**
 * A queue status or result URL from an accept body, pinned to the queue origin
 * and this request id (source falTrackingUrl), or `fallback` when absent.
 */
export function falTrackingUrl(value, requestId, kind, fallback) {
  if (value === undefined || value === null) return fallback;
  if (!isString(value) || value.length > 2048) return null;
  let url;
  try {
    url = new URL(value, FAL_QUEUE_ORIGIN);
  } catch {
    return null;
  }
  const tail = kind === "status" ? `/requests/${encodeURIComponent(requestId)}/status` : `/requests/${encodeURIComponent(requestId)}`;
  if (url.origin !== FAL_QUEUE_ORIGIN || url.username || url.password || url.hash || url.search || !url.pathname.endsWith(tail)) return null;
  return url.toString();
}

function retryAfterSeconds(value, now) {
  const text = value?.trim();
  if (!text) return 1;
  if (/^\d+$/.test(text)) return Number(text);
  const date = Date.parse(text);
  return Number.isNaN(date) ? Infinity : Math.max(0, (date - now) / 1000);
}

/**
 * One GET to a fal origin with the selected key, bounded by `timeoutMs` and
 * the caller's signal. 429 and 503 are retried at most twice when Retry-After
 * allows; any other answer is returned as is. Redirects are an error.
 *
 * @returns {Promise<Response>}
 * @throws the caller's abort reason, `{ name: "TimeoutError" }`, or `{ transport: true }`
 */
export async function falRead(url, { token, signal, timeoutMs, proxyOptions, wait, now = Date.now }) {
  const target = assertFalTarget(url);
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(Math.max(1, timeoutMs()));
    let response;
    try {
      response = await fetch(target, {
        method: "GET",
        headers: { Authorization: falAuthHeader(token), Accept: "application/json" },
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        proxyOptions,
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (timeout.aborted) throw Object.assign(new Error("fal read timed out"), { name: "TimeoutError" });
      throw Object.assign(new Error("fal read failed"), { transport: true });
    }
    if ([429, 503].includes(response.status) && attempt < FAL_MUSIC_MAX_READ_RETRIES) {
      const seconds = retryAfterSeconds(response.headers.get("retry-after"), now());
      if (seconds <= MAX_RETRY_AFTER_S && seconds * 1000 < timeoutMs()) {
        discard(response);
        await wait(Math.max(0, seconds * 1000), signal);
        continue;
      }
    }
    return response;
  }
}

/** A bounded JSON object body, or null when unreadable, oversized or not an object. */
export async function readJsonObject(response, { signal, timeoutMs, maxBytes }) {
  let text;
  try {
    text = await readBoundedResponseText(response, { signal, maxBytes, timeoutMs, throwOnTimeout: true });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw error;
    return null;
  }
  try {
    const value = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    // The parser's message quotes the body, so it is dropped.
    return null;
  }
}
