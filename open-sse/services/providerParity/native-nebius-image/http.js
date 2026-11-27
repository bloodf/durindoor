// Transport for the staged Nebius image adapter: one bounded, abortable fetch
// with manual redirects, origin checks and bounded body reads, plus the
// source's dynamic model discovery (GET /v1/models with the selected key).
import { readBoundedResponseText } from "../../../utils/error.js";
import { isRecord, isString } from "../../../../src/shared/utils/typeChecks.js";
import {
  NEBIUS_DISCOVERY_MAX_BYTES, NEBIUS_DISCOVERY_MAX_MODELS, NEBIUS_DISCOVERY_TIMEOUT_MS, NEBIUS_MODELS_URL,
  NEBIUS_PRIMARY_ORIGIN,
} from "./config.js";

// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(?:\/[A-Za-z0-9][A-Za-z0-9._:-]{0,99}){0,3}$/;

export const discard = (response) => void response?.body?.cancel?.().catch(() => {});
const timeoutError = () => Object.assign(new Error("request timed out"), { name: "TimeoutError" });

/** Whether a failed send provably never reached the upstream. */
export const provenUnsent = (error) => error?.notSent === true || PRE_CONNECT_ERROR_CODES.has(error?.cause?.code ?? error?.code);

/** A Nebius model id of safe syntax (no traversal, spaces, query or scheme). */
export const isSafeNebiusModelId = (id) => isString(id) && MODEL_ID_RE.test(id) && !id.split("/").some((part) => part === "." || part === "..");

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

/** True for a redirect answer (followed or not). */
export const isRedirect = (response) =>
  response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400) || response.redirected === true;

/** True when the answer came from another origin than the one asked. */
export function offOrigin(response, origin) {
  if (!response.url) return false;
  try {
    return new URL(response.url).origin !== origin;
  } catch {
    return true;
  }
}

/** Bounded text read; a timeout throws TimeoutError, an abort stays an abort. */
export const readText = (response, { signal, timeoutMs, maxBytes }) =>
  readBoundedResponseText(response, { signal, maxBytes, timeoutMs: Math.max(1, timeoutMs), throwOnTimeout: true });

/** Source parseResponse `data.data || data.models`, kept to safe, de-duplicated ids. */
export function parseNebiusModelList(answer) {
  const items = Array.isArray(answer?.data) ? answer.data : Array.isArray(answer?.models) ? answer.models : [];
  const ids = new Set();
  for (const item of items) {
    const id = isRecord(item) ? item.id : item;
    if (isSafeNebiusModelId(id)) ids.add(id);
    if (ids.size >= NEBIUS_DISCOVERY_MAX_MODELS) break;
  }
  return [...ids];
}

/**
 * Source dynamic discovery for the selected connection: GET
 * https://api.tokenfactory.nebius.com/v1/models with its Bearer key. The list
 * is every model the key can see; the source does not mark which are image
 * models, so neither does this. Never billable. Returns
 * `{ ok: true, models }` or `{ ok: false, status, error }`; an abort rethrows.
 */
export async function discoverNebiusModels({
  apiKey, fetchImpl = (...args) => globalThis.fetch(...args), signal, proxyOptions = null,
  timeoutMs = NEBIUS_DISCOVERY_TIMEOUT_MS,
}) {
  const key = isString(apiKey) ? apiKey.trim() : "";
  if (!key) return { ok: false, status: 401, error: "Nebius API key is required" };
  let response;
  try {
    response = await boundedFetch(fetchImpl, NEBIUS_MODELS_URL, {
      method: "GET",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      redirect: "manual",
      proxyOptions,
    }, { signal, timeoutMs });
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return { ok: false, status: error?.name === "TimeoutError" ? 504 : 502, error: "Nebius model discovery failed" };
  }
  if (isRedirect(response) || offOrigin(response, NEBIUS_PRIMARY_ORIGIN)) {
    discard(response);
    return { ok: false, status: 502, error: "Nebius model discovery redirect refused" };
  }
  if (!response.ok) {
    const { status } = response;
    discard(response);
    return { ok: false, status, error: `Nebius model discovery failed with ${status}` };
  }
  try {
    const text = await readText(response, { signal, timeoutMs, maxBytes: NEBIUS_DISCOVERY_MAX_BYTES });
    return { ok: true, models: parseNebiusModelList(JSON.parse(text)) };
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return { ok: false, status: 502, error: "Nebius model discovery returned an unreadable list" };
  }
}
