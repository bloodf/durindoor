// Transport for the staged MaxAI image adapter: one bounded, abortable fetch
// with manual redirects, bounded body reads, and the signing-constants
// discovery that reads MaxAI's public web bundle.
//
// Discovery follows the local executor's contract (open-sse/executors/maxai.js
// signingConstants: GET https://www.maxai.co/app/, the pages/_app chunk's `Mn`
// and `Rl` getters, the `webpage_x.y.z` app version, the 40-hex context key
// from the first signer chunk among at most 80) which ports OmniRoute c71f0065
// open-sse/executors/maxai/constants.ts fetchMaxaiConstants. Fork bounds: only
// same-origin `/_next/static/chunks/*.js` paths are fetched, every request has
// its own deadline and the whole discovery a total one, both follow the
// caller's signal, redirects are refused, bodies are size bounded, and no
// credential is ever sent to the web app.
import { readBoundedResponseText } from "../../../utils/error.js";
import { isRecord } from "../../../../src/shared/utils/typeChecks.js";
import {
  MAXAI_CONSTANTS_MAX_BYTES, MAXAI_CONSTANTS_MAX_CHUNKS, MAXAI_CONSTANTS_REQUEST_TIMEOUT_MS,
  MAXAI_CONSTANTS_TOTAL_TIMEOUT_MS, MAXAI_WEBAPP_ORIGIN, MAXAI_WEBAPP_PAGE,
} from "./config.js";
import { isUsableMaxaiConstants } from "./signing.js";

// Transport failures that happen before a connection exists: nothing was sent.
const PRE_CONNECT_ERROR_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]);
const CHUNK_PATH_RE = /\/_next\/static\/chunks\/[A-Za-z0-9/_-]+\.js/g;

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

/** Bounded text read; a timeout throws TimeoutError, an abort stays an abort. */
export const readText = (response, { signal, timeoutMs, maxBytes }) =>
  readBoundedResponseText(response, { signal, maxBytes, timeoutMs: Math.max(1, timeoutMs), throwOnTimeout: true });

function bundleLiteral(app, name) {
  const variable = app.match(new RegExp(`${name}\\s*:\\s*function\\s*\\(\\)\\s*\\{\\s*return\\s+([A-Za-z_$][\\w$]*)\\s*\\}`))?.[1];
  if (!variable) return null;
  const escaped = variable.replace(/\$/g, "\\$");
  return app.match(new RegExp(`(?:^|[^\\w$])${escaped}\\s*=\\s*"([^"]+)"`))?.[1] ?? null;
}

/**
 * Parse the constants out of the web app's `_app` chunk and one signer chunk.
 * Pure: returns a constants object or null.
 */
export function parseMaxaiBundle(appSource, signerSource) {
  const values = {
    hmacKey: bundleLiteral(appSource, "Mn"),
    aesKey: bundleLiteral(appSource, "Rl"),
    appVersion: appSource.match(/"(webpage_\d+\.\d+\.\d+)"/)?.[1] ?? null,
    ctxKey: signerSource?.match(/"([0-9a-f]{40})"\s*:\s*\{\s*a\s*:/)?.[1] ?? null,
  };
  return isUsableMaxaiConstants(values) ? values : null;
}

/**
 * Discover the signing constants from the public web bundle. Never sends a
 * credential; refuses redirects; bounded per request and in total; follows
 * the caller's signal (an abort rethrows). Returns null when extraction fails.
 */
export async function discoverMaxaiConstants({
  fetchImpl, signal, proxyOptions = null, now = Date.now,
  requestTimeoutMs = MAXAI_CONSTANTS_REQUEST_TIMEOUT_MS,
  totalTimeoutMs = MAXAI_CONSTANTS_TOTAL_TIMEOUT_MS,
  maxChunks = MAXAI_CONSTANTS_MAX_CHUNKS,
}) {
  const deadline = now() + totalTimeoutMs;
  const get = async (url) => {
    const left = deadline - now();
    if (left <= 0) throw timeoutError();
    const budget = Math.min(requestTimeoutMs, left);
    const response = await boundedFetch(fetchImpl, url, {
      method: "GET", headers: { Accept: "*/*" }, redirect: "manual", credentials: "omit", proxyOptions,
    }, { signal, timeoutMs: budget });
    if (!response.ok || offOrigin(response, MAXAI_WEBAPP_ORIGIN)) {
      discard(response);
      return null;
    }
    return readText(response, { signal, timeoutMs: Math.max(1, Math.min(budget, deadline - now())), maxBytes: MAXAI_CONSTANTS_MAX_BYTES });
  };
  try {
    const html = await get(MAXAI_WEBAPP_PAGE);
    if (!html) return null;
    const paths = [...new Set([...html.matchAll(CHUNK_PATH_RE)].map((match) => match[0]))];
    const appPath = paths.find((path) => /\/pages\/_app-[a-z0-9]+\.js$/i.test(path));
    if (!appPath) return null;
    const app = await get(`${MAXAI_WEBAPP_ORIGIN}${appPath}`);
    if (!app || !bundleLiteral(app, "Mn") || !bundleLiteral(app, "Rl")) return null;
    for (const path of paths.filter((candidate) => /\/chunks\/[A-Za-z0-9]+-[a-z0-9]+\.js$/i.test(candidate)).slice(0, maxChunks)) {
      const source = await get(`${MAXAI_WEBAPP_ORIGIN}${path}`);
      if (!source || !/nj\)\("[0-9a-f]+"\)/.test(source)) continue;
      const parsed = parseMaxaiBundle(app, source);
      if (parsed) return parsed;
    }
    return null;
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return null;
  }
}

/**
 * A signing-constants source with an in-process memo of the last discovered
 * set. Order: the connection's saved `providerSpecificData.maxaiSigningConstants`
 * (the field the local chat executor honors), an injected `constants` object,
 * the memo, then discovery. Saved per-connection sets are never memoized.
 */
export function createMaxaiConstantsSource({ constants = null, discover = discoverMaxaiConstants } = {}) {
  let memo = null;
  return {
    async resolve({ credentials, fetchImpl, signal, proxyOptions, now }) {
      const saved = credentials?.providerSpecificData?.maxaiSigningConstants;
      if (isRecord(saved) && isUsableMaxaiConstants(saved)) return saved;
      if (constants && isUsableMaxaiConstants(constants)) return constants;
      if (memo) return memo;
      const found = await discover({ fetchImpl, signal, proxyOptions, now });
      if (found && isUsableMaxaiConstants(found)) memo = found;
      return memo;
    },
    reset() {
      memo = null;
    },
  };
}
