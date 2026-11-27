import * as proxyFetch from "../utils/proxyFetch.js";
import { FETCH_CONNECT_TIMEOUT_MS, resolveRequestRetryPolicy } from "../config/runtimeConfig.js";
import {
  prepareProviderAttemptDispatch,
  runProviderAttemptDispatch,
  runQuotaBearingProviderRequest,
  settleProviderAttemptDispatch,
  transferProviderAttemptDispatch
} from "../services/providerAttemptContext.js";
import {
  boundRelayStreamLifetime,
  fetchConnectTimeoutError,
  isRelaySseResponse
} from "../utils/relayStreamLifecycle.js";
import { isFunction, isObject, isString } from "../../src/shared/utils/typeChecks.js";

const DURINDOOR_FETCH_PATCH = Symbol.for("durindoor.proxyFetch.patched");

export function requestAbortError(reason) {
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  return new DOMException("Provider request aborted", "AbortError");
}

const SECRET_HEADER = /authorization|cookie|token|secret|api[-_]?key|(^|[-_])key$/i;
const SECRET_QUERY = /^(key|api[-_]?key|access[-_]?token|token)$/i;
const CREDENTIAL_FIELDS = ["apiKey", "accessToken", "cookie"];

/** "public" is the shared placeholder of no-auth providers, not a secret. */
function isSecretValue(value) {
  if (!isString(value)) return Boolean(value);
  const secret = value.replace(/^\s*bearer\b/i, "").trim();
  return secret !== "" && secret !== "public";
}

/**
 * Whether a send carries an API key, bearer token or cookie. The stored
 * credential counts too, for keys placed in the body or an unusual header.
 */
export function carriesCredential(url, headers, credentials) {
  if (CREDENTIAL_FIELDS.some((field) => isSecretValue(credentials?.[field]))) return true;
  const entries = headers instanceof Headers ? [...headers] : Object.entries(headers || {});
  if (entries.some(([name, value]) => SECRET_HEADER.test(name) && isSecretValue(value))) return true;
  const query = URL.canParse(url) ? [...new URL(url).searchParams] : [];
  return query.some(([name, value]) => SECRET_QUERY.test(name) && isSecretValue(value));
}

/** A refused redirect rejects the send instead of returning the 3xx response. */
export function isRefusedRedirect(error) {
  return /unexpected redirect/i.test(`${error?.message} ${error?.cause?.message}`);
}

/**
 * Whether the connection is bound to a proxy or relay. A subprocess owns its own
 * egress, so a CLI executor must refuse such a connection instead of going direct.
 */
export function bindsConnectionRoute(proxyOptions) {
  return Boolean(proxyOptions?.strictProxy || proxyOptions?.proxyPoolId || proxyOptions?.connectionProxyPoolId ||
    proxyOptions?.connectionProxyEnabled || proxyOptions?.vercelRelayUrl);
}

/** Release a discarded response without trusting provider-controlled cancel latency. */
export function cancelDiscardedResponse(response) {
  try {
    const cancellation = response?.body?.cancel?.("discarded provider response");
    if (cancellation?.catch) void cancellation.catch(() => {});
  } catch {/* body may already be locked or closed */}
}

function sendThroughProxy(url, options, proxyOptions, { observePatchedFetch, unrouted, globalFetch }) {
  let proxyAwareFetch;
  try {
    proxyAwareFetch = proxyFetch.proxyAwareFetch;
  } catch {
    // Some executor suites stub the entire proxy module.
  }
  const live = globalThis.fetch;
  // The patched global fetch routes through proxyAwareFetch and records its own dispatch.
  if (globalFetch && live?.[DURINDOOR_FETCH_PATCH] === true) return live(url, { ...options, proxyOptions });
  if (globalFetch || !isFunction(proxyAwareFetch)) {
    return runProviderAttemptDispatch(() => live(url, { ...options, proxyOptions }));
  }
  if (observePatchedFetch && !options.directFetch && live?.[DURINDOOR_FETCH_PATCH] === true) {
    return live(url, { ...options, proxyOptions });
  }
  // An unrouted send (a local sidecar) passes no connection route at all.
  return unrouted ? proxyAwareFetch(url, options) : proxyAwareFetch(url, options, proxyOptions);
}

/**
 * A replacement global fetch to hand to proxyAwareFetch as `directFetch`. The
 * patched global is left out: it re-enters proxyAwareFetch, which would record
 * and charge one physical send twice.
 */
export function unpatchedGlobalFetch() {
  const live = globalThis.fetch;
  return live?.[DURINDOOR_FETCH_PATCH] === true ? undefined : live;
}

/** Stop waiting on a pending operation as soon as the signal aborts. */
export function abortable(pending, signal) {
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const abort = () => reject(requestAbortError(signal.reason));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(pending).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/**
 * Run a send that is not a fetch (WebSocket frame, subprocess, app-server RPC).
 * The transport receives the merged signal, and the sender stops waiting when it
 * aborts even if the transport ignores it. An abort or header deadline wins
 * over whatever error the transport raised while shutting down. There is no
 * URL to proxy or redirect to guard here: a transport owns its own egress.
 */
async function runTransport(transport, options, timeoutSignal) {
  const { signal } = options;
  const abortCause = () => timeoutSignal.aborted && signal.reason === timeoutSignal.reason ?
    timeoutSignal.reason : requestAbortError(signal.reason);
  if (signal.aborted) throw abortCause();
  try {
    return await abortable(transport(options), signal);
  } catch (error) {
    throw signal.aborted ? abortCause() : error;
  }
}

export function resolveHeaderTimeout(config, requestPolicy) {
  return requestPolicy.headerTimeoutMs || config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
}

/**
 * Create one sender per execute() call. Each send gets a fresh header deadline
 * and records its physical dispatch. Setup and stream-read requests can opt
 * out of quota charging with quotaBearing: false.
 *
 * BaseExecutor defers header cleanup until its protocol replays are finished
 * so a relay SSE response can keep the deadline for the lifetime of its body.
 */
export function createRequestSender({
  attemptStartedAt = null,
  onProviderAttempt = null,
  headerTimeoutMs = FETCH_CONNECT_TIMEOUT_MS,
  credentialed = true,
  deferHeaders = false,
  observePatchedFetch = false
} = {}) {
  let latest = Number.isSafeInteger(attemptStartedAt) && attemptStartedAt > 0 ? attemptStartedAt : null;
  let dispatched = false;
  let deadline;
  const clearHeaderTimer = () => clearTimeout(deadline?.timer);

  async function sendRequest(url, init, proxyOptions = null, { quotaBearing = true, transport = null, unrouted = false, globalFetch = false } = {}) {
    const signal = init.signal;
    if (signal?.aborted) throw requestAbortError(signal.reason);
    clearHeaderTimer();
    const controller = new AbortController();
    const mergedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(fetchConnectTimeoutError(headerTimeoutMs)), headerTimeoutMs);
    deadline = { controller, mergedSignal, timer };

    try {
      const contextual = prepareProviderAttemptDispatch();
      if (Number.isSafeInteger(contextual) && contextual > 0) {
        latest = contextual;
      } else if (dispatched || latest === null) {
        const allocated = isFunction(onProviderAttempt) ? onProviderAttempt() : Date.now();
        if (Number.isSafeInteger(allocated) && allocated > 0) latest = allocated;
      }
      dispatched = true;
      const options = { ...(credentialed ? { redirect: "error" } : null), ...init, signal: mergedSignal };
      const send = transport ?
        () => runProviderAttemptDispatch(() => runTransport(transport, options, controller.signal)) :
        () => sendThroughProxy(url, options, proxyOptions, { observePatchedFetch, unrouted, globalFetch });
      return await (quotaBearing ? runQuotaBearingProviderRequest(send) : send());
    } catch (error) {
      clearTimeout(timer);
      if (error && isObject(error)) error.providerAttemptStartedAt ??= latest;
      throw error;
    } finally {
      if (!deferHeaders) clearTimeout(timer);
    }
  }

  function finishHeaders(response, proxyOptions) {
    const { controller, mergedSignal, timer } = deadline;
    if (!proxyOptions?.vercelRelayUrl || !isRelaySseResponse(response)) {
      clearTimeout(timer);
      return response;
    }
    const wrapped = new Response(boundRelayStreamLifetime(response.body, {
      signal: mergedSignal,
      timeoutSignal: controller.signal,
      onFinalize: () => clearTimeout(timer)
    }), { status: response.status, statusText: response.statusText, headers: response.headers });
    transferProviderAttemptDispatch(response, wrapped);
    return wrapped;
  }

  return {
    sendRequest,
    finishHeaders,
    clearHeaderTimer,
    get attemptStartedAt() { return latest; },
    get timeoutReason() {
      const timeout = deadline?.controller.signal;
      // The merged signal records which abort happened first.
      return timeout?.aborted && deadline.mergedSignal.reason === timeout.reason ? timeout.reason : null;
    }
  };
}

/**
 * Run an execute() body that makes its quota-bearing send somewhere inside. The
 * body passes that send's response to billed(); the ticket then moves to the
 * returned response, or is settled when the body throws instead.
 */
export async function withBillableDispatch(sender, run) {
  let dispatch = null;
  let startedAt = null;
  const billed = (response) => {
    dispatch = response;
    startedAt = sender.attemptStartedAt;
    return response;
  };
  try {
    const result = await run(billed);
    if (!result?.response) return result;
    transferProviderAttemptDispatch(dispatch, result.response);
    const attemptStartedAt = startedAt ?? sender.attemptStartedAt;
    return attemptStartedAt ? { ...result, attemptStartedAt } : result;
  } catch (error) {
    await settleProviderAttemptDispatch(dispatch, { reason: error?.name === "AbortError" ? "abort" : "transport_error" });
    throw error;
  }
}

/**
 * Apply the provider's configured header deadline to a custom executor. An
 * override that called proxyAwareFetch itself passes observePatchedFetch: false.
 */
export function createExecutorSender(executor, input, { observePatchedFetch = true } = {}) {
  return createRequestSender({
    attemptStartedAt: input.attemptStartedAt,
    onProviderAttempt: input.onProviderAttempt,
    headerTimeoutMs: resolveHeaderTimeout(executor.config, resolveRequestRetryPolicy(executor.provider, input.requestPolicy)),
    observePatchedFetch
  });
}
