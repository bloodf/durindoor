// Transport for the staged Topaz image adapter: one bounded, abortable fetch
// with manual redirects and a bounded binary body read. Same contract as the
// other staged native adapters (native-hyperbolic-image/http.js,
// native-deapi-video-image/http.js); kept local so this staging has no
// cross-staging import.

// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});
const timeoutError = () => Object.assign(new Error("request timed out"), { name: "TimeoutError" });

/** Whether a failed send provably never reached the upstream. */
export const provenUnsent = (error) => error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);

/**
 * One request bounded by the caller's signal and a deadline. The wait ends on
 * either even when a transport ignores its signal; a late answer is discarded.
 * Throws an AbortError tagged `notSent` when the caller left before the send.
 */
export async function boundedFetch(fetchImpl, url, init, { signal, timeoutMs }) {
  if (signal?.aborted) throw Object.assign(new Error("aborted before send"), { name: "AbortError", notSent: true });
  const deadline = new AbortController();
  const fetchSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  let timedOut = false;
  let stopWaiting;
  const timer = setTimeout(() => {
    timedOut = true;
    deadline.abort(timeoutError());
  }, Math.max(1, timeoutMs));
  const bound = new Promise((_, rejectWait) => {
    stopWaiting = () => rejectWait(timedOut ? timeoutError() : fetchSignal.reason);
    fetchSignal.addEventListener("abort", stopWaiting, { once: true });
  });
  const pending = Promise.resolve().then(() => fetchImpl(url, { ...init, signal: fetchSignal }));
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

/** True for a redirect answer (followed or not) or an answer from another origin. */
export function offOrigin(response, origin) {
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400) || response.redirected) return true;
  if (!response.url) return false;
  try {
    return new URL(response.url).origin !== origin;
  } catch {
    return true;
  }
}

/**
 * Read at most `maxBytes` of a binary body within `timeoutMs`. Throws a
 * TimeoutError, the caller's AbortError, or an Error tagged `tooLarge`; the
 * stream is cancelled in every one of those cases.
 */
export async function readBoundedBytes(response, { signal, timeoutMs, maxBytes }) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    discard(response);
    throw Object.assign(new Error("body too large"), { tooLarge: true });
  }
  const reader = response.body?.getReader?.();
  if (!reader) return new Uint8Array(0);
  let timer;
  let onAbort;
  const stop = new Promise((_, rejectRead) => {
    timer = setTimeout(() => rejectRead(timeoutError()), Math.max(1, timeoutMs));
    onAbort = () => rejectRead(Object.assign(new Error("aborted"), { name: "AbortError" }));
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
  stop.catch(() => {});
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), stop]);
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value ?? []);
      total += chunk.byteLength;
      if (total > maxBytes) throw Object.assign(new Error("body too large"), { tooLarge: true });
      chunks.push(chunk);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}
