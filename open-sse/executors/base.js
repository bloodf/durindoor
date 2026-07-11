import { HTTP_STATUS, RETRY_CONFIG, DEFAULT_RETRY_CONFIG, resolveRetryEntry, FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { shouldRefreshCredentials } from "../services/oauthCredentialManager.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { dbg } from "../utils/debugLog.js";
import { ANTHROPIC_API_VERSION, OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE } from "../providers/shared.js";
import { findOffendingField } from "../config/providerFieldStrips.js";
import { readBoundedResponseText } from "../utils/error.js";
import {
  prepareProviderAttemptDispatch,
  runQuotaBearingProviderRequest,
  settleProviderAttemptDispatch,
} from "../services/providerAttemptContext.js";
import { isQuotaDispatchUnavailable } from "../services/quota/dispatch.js";

function removeBetaFlag(headers, flag) {
  for (const key of ["anthropic-beta", "Anthropic-Beta"]) {
    if (!headers[key]) continue;
    const filtered = headers[key]
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .filter(f => f !== flag)
      .join(",");
    if (filtered) headers[key] = filtered;
    else delete headers[key];
  }
}

function requestAbortError(reason) {
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  return new DOMException("Provider request aborted", "AbortError");
}

/** Release a discarded response without trusting provider-controlled cancel latency. */
function cancelDiscardedResponse(response) {
  try {
    const cancellation = response?.body?.cancel?.("discarded provider response");
    if (cancellation?.catch) void cancellation.catch(() => {});
  } catch { /* body may already be locked or closed */ }
}

/** Abort-aware retry delay with deterministic listener/timer cleanup. */
export function waitForRetryDelay(delayMs, signal = null) {
  if (signal?.aborted) return Promise.reject(requestAbortError(signal.reason));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, requestAbortError(signal?.reason));
    const timer = setTimeout(() => finish(resolve), Math.max(0, delayMs));
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

/**
 * BaseExecutor - Base class for provider executors
 */
export class BaseExecutor {
  constructor(provider, config) {
    this.provider = provider;
    this.config = config;
    this.noAuth = config?.noAuth || false;
  }

  getProvider() {
    return this.provider;
  }

  getBaseUrls() {
    return this.config.baseUrls || (this.config.baseUrl ? [this.config.baseUrl] : []);
  }

  getFallbackCount() {
    return this.getBaseUrls().length || 1;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    if (this.provider?.startsWith?.("openai-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || OPENAI_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      const path = this.provider.includes("responses") ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || ANTHROPIC_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}/messages`;
    }
    const baseUrls = this.getBaseUrls();
    return baseUrls[urlIndex] || baseUrls[0] || this.config.baseUrl;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers
    };

    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      // Anthropic-compatible providers use x-api-key header
      if (credentials.apiKey) {
        headers["x-api-key"] = credentials.apiKey;
      } else if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      if (!headers["anthropic-version"]) {
        headers["anthropic-version"] = ANTHROPIC_API_VERSION;
      }
    } else {
      // Standard Bearer token auth for other providers
      if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      } else if (credentials.apiKey) {
        headers["Authorization"] = `Bearer ${credentials.apiKey}`;
      }
    }

    if (stream) {
      headers["Accept"] = "text/event-stream";
    }

    return headers;
  }

  // Override in subclass for provider-specific transformations
  transformRequest(model, body, stream, credentials) {
    return body;
  }

  shouldRetry(status, urlIndex) {
    return status === HTTP_STATUS.RATE_LIMITED && urlIndex + 1 < this.getFallbackCount();
  }

  // Override in subclass for provider-specific refresh
  async refreshCredentials(credentials, log, proxyOptions = null) {
    return null;
  }

  needsRefresh(credentials) {
    return shouldRefreshCredentials(this.provider, credentials);
  }

  parseError(response, bodyText) {
    return { status: response.status, message: bodyText || `HTTP ${response.status}` };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null, requestContext = null, attemptStartedAt = null, onProviderAttempt = null }) {
    if (signal?.aborted) throw requestAbortError(signal.reason);
    const fallbackCount = this.getFallbackCount();
    let lastError = null;
    let lastStatus = 0;
    const retryAttemptsByUrl = {};
    let providerAttemptStartedAt = Number.isSafeInteger(attemptStartedAt) && attemptStartedAt > 0
      ? attemptStartedAt
      : null;
    let dispatchCount = 0;
    const beginDispatch = () => {
      const contextual = prepareProviderAttemptDispatch();
      if (Number.isSafeInteger(contextual) && contextual > 0) {
        providerAttemptStartedAt = contextual;
        dispatchCount += 1;
        return providerAttemptStartedAt;
      }
      if (dispatchCount > 0 || providerAttemptStartedAt === null) {
        const allocated = typeof onProviderAttempt === "function" ? onProviderAttempt() : Date.now();
        if (Number.isSafeInteger(allocated) && allocated > 0) providerAttemptStartedAt = allocated;
      }
      dispatchCount += 1;
      return providerAttemptStartedAt;
    };

    // Merge default retry config with provider-specific config
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };

    // Schedule retry via retryConfig[statusKey]. Returns true when caller should `urlIndex--; continue`
    // response (optional) lets a subclass hook compute a dynamic delay (e.g. antigravity Retry-After).
    const tryRetry = async (urlIndex, statusKey, reason, response = null) => {
      const { attempts, delayMs } = resolveRetryEntry(retryConfig[statusKey]);
      if (attempts <= 0 || retryAttemptsByUrl[urlIndex] >= attempts) return false;
      // Hook: subclass may derive delay from the response (headers/body). null → skip retry, use fallback.
      let waitMs = delayMs;
      if (response && this.computeRetryDelay) {
        let dynamic;
        try {
          dynamic = await this.computeRetryDelay(response, retryAttemptsByUrl[urlIndex] + 1, delayMs, {
            signal,
            maxBytes: 64 * 1024,
            timeoutMs: 2_000,
          });
        } catch (error) {
          await settleProviderAttemptDispatch(response, { success: false, reason: "upstream_error" });
          cancelDiscardedResponse(response);
          throw error;
        }
        if (dynamic === false) return false; // hook vetoes retry (e.g. Retry-After too long)
        if (dynamic != null) waitMs = dynamic;
      }
      retryAttemptsByUrl[urlIndex]++;
      log?.debug?.("RETRY", `${reason} retry ${retryAttemptsByUrl[urlIndex]}/${attempts} after ${waitMs / 1000}s`);
      await settleProviderAttemptDispatch(response, { success: false, reason: "fallback" });
      cancelDiscardedResponse(response);
      await waitForRetryDelay(waitMs, signal);
      return true;
    };

    for (let urlIndex = 0; urlIndex < fallbackCount; urlIndex++) {
      if (signal?.aborted) throw requestAbortError(signal.reason);
      // Request context carries internal, request-scoped routing metadata without
      // placing private markers on provider credentials or outbound JSON bodies.
      // Extra arguments are backward-compatible with executors that do not use it.
      const url = this.buildUrl(model, stream, urlIndex, credentials, requestContext);
      const transformedBody = this.transformRequest(model, body, stream, credentials, requestContext);
      const headers = this.buildHeaders(credentials, stream, requestContext);
      if (transformedBody?.thinking?.display === "summarized") {
        removeBetaFlag(headers, "redact-thinking-2026-02-12");
      }

      if (!retryAttemptsByUrl[urlIndex]) retryAttemptsByUrl[urlIndex] = 0;

      // Abort if upstream doesn't return response headers within connection timeout
      let connectCtrl = new AbortController();
      const timeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
      let connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), timeoutMs);
      let mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

      try {
        let requestBody = transformedBody;
        let bodyStr = JSON.stringify(requestBody);
        const fetchT0 = Date.now();
        dbg("FETCH", `${this.provider.toUpperCase()} → ${url} | body=${bodyStr.length}B | connectTimeout=${timeoutMs}ms`);
        beginDispatch();
        let response = await runQuotaBearingProviderRequest(() => proxyAwareFetch(url, {
          method: "POST",
          headers,
          body: bodyStr,
          signal: mergedSignal
        }, proxyOptions));
        if (response.status === 400) {
          const clone = response.clone?.();
          const errorText = clone
            ? await readBoundedResponseText(clone, { signal, maxBytes: 64 * 1024, timeoutMs: 2_000 })
            : "";
          const field = findOffendingField(errorText);
          if (
            field &&
            requestBody &&
            typeof requestBody === "object" &&
            !Array.isArray(requestBody) &&
            Object.prototype.hasOwnProperty.call(requestBody, field)
          ) {
            requestBody = { ...requestBody };
            delete requestBody[field];
            bodyStr = JSON.stringify(requestBody);
            log?.debug?.("RETRY", `400 mentioned unsupported field ${field}; stripping and retrying once`);
            await settleProviderAttemptDispatch(response, { success: false, reason: "fallback" });
            cancelDiscardedResponse(response);
            // Reset the connect timeout for the new upstream request.
            clearTimeout(connectTimer);
            connectCtrl = new AbortController();
            connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), timeoutMs);
            mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;
            beginDispatch();
            response = await runQuotaBearingProviderRequest(() => proxyAwareFetch(url, {
              method: "POST",
              headers,
              body: bodyStr,
              signal: mergedSignal
            }, proxyOptions));
          }
        }
        clearTimeout(connectTimer);
        const ct = response.headers?.get?.("content-type") || "";
        const cl = response.headers?.get?.("content-length") || "?";
        dbg("FETCH", `${this.provider.toUpperCase()} ← ${response.status} | ttft=${Date.now() - fetchT0}ms | ct=${ct} | cl=${cl}`);

        if (await tryRetry(urlIndex, response.status, `status ${response.status}`, response)) { urlIndex--; continue; }

        if (this.shouldRetry(response.status, urlIndex)) {
          log?.debug?.("RETRY", `${response.status} on ${url}, trying fallback ${urlIndex + 1}`);
          lastStatus = response.status;
          await settleProviderAttemptDispatch(response, { success: false, reason: "fallback" });
          cancelDiscardedResponse(response);
          continue;
        }

        return {
          response,
          url,
          headers,
          transformedBody: requestBody,
          attemptStartedAt: providerAttemptStartedAt,
          terminalProvenance: "upstream",
        };
      } catch (error) {
        clearTimeout(connectTimer);
        if (isQuotaDispatchUnavailable(error)) throw error;
        lastError = error;
        const isConnectTimeout = connectCtrl.signal.aborted && error.name === "AbortError";
        dbg("FETCH", `${this.provider.toUpperCase()} ✖ ${error.name}: ${error.message}${isConnectTimeout ? " (connect timeout)" : ""}`);
        // Connect timeout is internal — convert to retryable network error, don't propagate AbortError
        if (error.name === "AbortError" && !isConnectTimeout) {
          error.providerAttemptStartedAt = providerAttemptStartedAt;
          throw error;
        }

        // Map network/fetch exceptions to 502 retry config
        if (await tryRetry(urlIndex, HTTP_STATUS.BAD_GATEWAY, `network "${error.message}"`)) { urlIndex--; continue; }

        if (urlIndex + 1 < fallbackCount) {
          log?.debug?.("RETRY", `Error on ${url}, trying fallback ${urlIndex + 1}`);
          continue;
        }
        error.providerAttemptStartedAt = providerAttemptStartedAt;
        throw error;
      }
    }

    const error = lastError || new Error(`All ${fallbackCount} URLs failed with status ${lastStatus}`);
    error.providerAttemptStartedAt = providerAttemptStartedAt;
    throw error;
  }
}

export default BaseExecutor;
