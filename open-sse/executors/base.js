import { HTTP_STATUS, RETRY_CONFIG, DEFAULT_RETRY_CONFIG, resolveRetryEntry, FETCH_CONNECT_TIMEOUT_MS, matchSkipRule, resolveRequestRetryPolicy } from "../config/runtimeConfig.js";
import { shouldRefreshCredentials } from "../services/oauthCredentialManager.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { boundRelayStreamLifetime, fetchConnectTimeoutError, isRelaySseResponse } from "../utils/relayStreamLifecycle.js";
import { dbg } from "../utils/debugLog.js";
import { ANTHROPIC_API_VERSION, OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE } from "../providers/shared.js";
import { findOffendingField } from "../config/providerFieldStrips.js";
import { readBoundedResponseText } from "../utils/error.js";
import {
  prepareProviderAttemptDispatch,
  runQuotaBearingProviderRequest,
  settleProviderAttemptDispatch,
  transferProviderAttemptDispatch,
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
  /**
   * Clamp token-limit fields to a custom-model maxOutput override.
   * Runs centrally in execute() after transformRequest, covering every
   * executor: OpenAI-style (max_tokens/max_completion_tokens), Responses
   * (max_output_tokens), Claude (max_tokens), and Gemini-envelope bodies
   * (generationConfig.maxOutputTokens, incl. Antigravity's request wrapper).
   * Executors building non-JSON/binary bodies clamp in their own transform.
   * No-op without a custom cap; never invents absent fields.
   */
  clampCustomMaxOutput(body, requestContext, fields = ["max_tokens", "max_completion_tokens", "max_output_tokens"]) {
    const customMax = requestContext?.modelCapabilities?.maxOutput;
    if (!body || typeof body !== "object" || !(Number.isFinite(customMax) && customMax > 0)) return body;
    for (const field of fields) {
      if (typeof body[field] === "number" && body[field] > customMax) {
        body[field] = customMax;
      }
    }
    for (const holder of [body, body.request]) {
      const gc = holder?.generationConfig;
      if (gc && typeof gc.maxOutputTokens === "number" && gc.maxOutputTokens > customMax) {
        gc.maxOutputTokens = customMax;
      }
    }
    return body;
  }

  /**
   * Output tokens the request will actually reserve against the context
   * window — i.e. exactly what {@link clampCustomMaxOutput} will let through.
   *
   * The client's explicit value wins, but only up to the catalog cap, because
   * the clamp rewrites anything larger down to that cap. Returning the raw
   * client number would over-reserve and reject requests the provider would
   * have accepted. Absent/zero/negative client values fall back to the cap, so
   * a request naming no output limit is still charged the provider's default.
   *
   * Mirrors the clamp's field list, including both Gemini-envelope shapes.
   */
  resolveEffectiveOutputReservation(body, requestContext) {
    const customMax = requestContext?.modelCapabilities?.maxOutput;
    const cap = Number.isFinite(customMax) && customMax > 0 ? customMax : 0;
    if (!body || typeof body !== "object") return cap;
    const candidates = [
      body.max_tokens,
      body.max_completion_tokens,
      body.max_output_tokens,
      body?.generationConfig?.maxOutputTokens,
      body?.request?.generationConfig?.maxOutputTokens,
    ];
    for (const value of candidates) {
      if (Number.isFinite(value) && value > 0) return cap > 0 ? Math.min(value, cap) : value;
    }
    return cap;
  }

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

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null, requestContext = null, attemptStartedAt = null, onProviderAttempt = null, requestPolicy = null }) {
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

    // Merge default retry config with provider-specific config (base ceiling per status).
    // NOTE: never mutate this.config — executors are cached singletons shared across
    // concurrent requests. All per-request policy lives in local vars derived from requestPolicy.
    const baseRetry = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };
    // Provider skip-error rules + transport retry policy (9router #2588).
    // requestPolicy == null → nulls everywhere → identical pre-port behavior.
    const policy = resolveRequestRetryPolicy(this.provider, requestPolicy);
    const maxTransportAttempts = policy.maxTransportAttempts;
    const skipRules = policy.skipRules;
    const hasContainsRule = policy.hasContainsRule;
    // Header/connect timeout: per-request policy override → provider config → global default.
    const headerTimeoutMs = policy.headerTimeoutMs || this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;

    // Resolve how many in-place retries a failure gets, honoring skip-rules and the
    // transport-attempt ceiling (see the attempts table in runtimeConfig.js).
    const resolveAttempts = ({ statusKey, errorKind, text }) => {
      const base = resolveRetryEntry(baseRetry[statusKey]);
      const rule = skipRules
        ? matchSkipRule(this.provider, { status: statusKey, errorKind, text }, skipRules)
        : null;
      const cap = maxTransportAttempts != null ? Math.max(0, maxTransportAttempts - 1) : null;

      if (rule?.action === "skip") return { attempts: 0, delayMs: base.delayMs };
      if (rule?.action === "retry") {
        return { attempts: cap != null ? cap : base.attempts, delayMs: base.delayMs };
      }
      // No explicit rule: connect_timeout gets 0 in-place retries; the account
      // layer fails over instead of re-hitting a stalled upstream.
      if (errorKind === "connect_timeout") return { attempts: 0, delayMs: base.delayMs };
      const attempts = cap != null ? Math.min(base.attempts, cap) : base.attempts;
      return { attempts, delayMs: base.delayMs };
    };

    // A matched skip-rule means: abandon this account entirely — do NOT cycle the
    // remaining transport fallback URLs on the same account (which would keep hitting
    // a stalled/at-capacity upstream). The account-selection layer picks the next
    // account/model. Returns the matched rule ({action:"skip", ...}) or null.
    const matchedSkip = ({ statusKey, errorKind, text }) => {
      if (!skipRules) return null;
      const rule = matchSkipRule(this.provider, { status: statusKey, errorKind, text }, skipRules);
      return rule?.action === "skip" ? rule : null;
    };

    // Schedule retry via resolveAttempts. Returns true when caller should `urlIndex--; continue`
    // response (optional) lets a subclass hook compute a dynamic delay (e.g. antigravity Retry-After).
    const tryRetry = async (urlIndex, statusKey, reason, response = null, errorKind = null, text = null) => {
      const { attempts, delayMs } = resolveAttempts({ statusKey, errorKind, text });
      if (attempts <= 0 || retryAttemptsByUrl[urlIndex] >= attempts) return false;
      const matchedRule = skipRules
        ? matchSkipRule(this.provider, { status: statusKey, errorKind, text }, skipRules)
        : null;
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
        // Upstream #2588 removed the hardcoded antigravity 503-capacity veto so an
        // explicit user retry-rule wins. Dev keeps that veto inside computeRetryDelay
        // (antigravity.js untouched), so base converts ONLY that exact veto to the
        // base delay when a matching explicit retry-rule exists. Every other veto
        // (Retry-After too long, non-transient, etc.) still stands.
        const isAntigravityCapacityVeto = this.provider === "antigravity"
          && Number(statusKey) === 503
          && typeof text === "string" && text.toLowerCase().includes("capacity");
        if (dynamic === false && !(isAntigravityCapacityVeto && matchedRule?.action === "retry")) {
          return false; // hook vetoes retry (e.g. Retry-After too long)
        }
        if (dynamic != null && dynamic !== false) waitMs = dynamic;
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
      const transformedBody = this.clampCustomMaxOutput(
        this.transformRequest(model, body, stream, credentials, requestContext),
        requestContext,
      );
      const headers = this.buildHeaders(credentials, stream, requestContext);
      // Forward the client's request id through the relay (OmniRoute#7093),
      // without overriding an id the executor already set. Headers may arrive
      // under any casing, so read them through a Headers instance. Relay-only:
      // direct provider requests keep their existing header shape.
      if (proxyOptions?.vercelRelayUrl) {
        const clientRequestId = new Headers(requestContext?.clientHeaders ?? {}).get("x-request-id");
        if (clientRequestId && new Headers(headers).get("x-request-id") == null) {
          if (headers instanceof Headers) headers.set("x-request-id", clientRequestId);
          else headers["x-request-id"] = clientRequestId;
        }
      }
      if (transformedBody?.thinking?.display === "summarized") {
        removeBetaFlag(headers, "redact-thinking-2026-02-12");
      }

      if (!retryAttemptsByUrl[urlIndex]) retryAttemptsByUrl[urlIndex] = 0;

      // Abort if upstream doesn't return response headers within the connect/header timeout.
      // OUR timeout is proven by reason identity at the catch (mergedSignal.reason ===
      // connectCtrl.signal.reason): undici rejects with the exact reason object we pass to
      // abort(), and a near-simultaneous caller abort must not be misclassified.
      let connectCtrl = new AbortController();
      const armConnectTimer = () => setTimeout(() => {
        connectCtrl.abort(fetchConnectTimeoutError());
      }, headerTimeoutMs);
      let connectTimer = armConnectTimer();
      let mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

      try {
        let requestBody = transformedBody;
        let bodyStr = JSON.stringify(requestBody);
        const fetchT0 = Date.now();
        dbg("FETCH", `${this.provider.toUpperCase()} → ${url} | body=${bodyStr.length}B | connectTimeout=${headerTimeoutMs}ms`);
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
            connectTimer = armConnectTimer();
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
        // Relayed SSE (vercel relay): keep the timeout/abort signal live until
        // the body actually ends — EOF, error, downstream cancel, or caller
        // abort — so a stalled stream cannot bypass retry/fallback (port of
        // diegosouzapw/OmniRoute#7093 "bound Bifrost stream lifetime").
        const relaySse = Boolean(proxyOptions?.vercelRelayUrl) && isRelaySseResponse(response);
        if (relaySse) {
          const originalResponse = response;
          response = new Response(
            boundRelayStreamLifetime(response.body, {
              signal: mergedSignal,
              timeoutSignal: connectCtrl.signal,
              onFinalize: () => clearTimeout(connectTimer),
            }),
            {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            }
          );
          // Keep the quota dispatch ticket reachable through the rebuilt response.
          transferProviderAttemptDispatch(originalResponse, response);
        } else {
          clearTimeout(connectTimer);
        }
        const ct = response.headers?.get?.("content-type") || "";
        const cl = response.headers?.get?.("content-length") || "?";
        dbg("FETCH", `${this.provider.toUpperCase()} ← ${response.status} | ttft=${Date.now() - fetchT0}ms | ct=${ct} | cl=${cl}`);

        // Read the error body ONLY when a contains-rule for this provider could fire
        // (and the status is an error). Clone + bounded read so a provider-controlled
        // body cannot hang the request or grow memory; the original body stays intact
        // for the caller/translator. Unreadable/oversized → no contains match.
        let errorText = null;
        if (hasContainsRule && response.status >= 400) {
          try {
            errorText = await readBoundedResponseText(response.clone(), { signal, maxBytes: 64 * 1024, timeoutMs: 2_000 });
          } catch (probeError) {
            // A caller abort during the probe must cancel the request, not be
            // swallowed into a silent no-match that returns the upstream response.
            if (probeError?.name === "AbortError" || signal?.aborted) throw probeError;
            // unreadable/oversized body → skip contains matching
          }
        }

        if (await tryRetry(urlIndex, response.status, `status ${response.status}`, response, `http_${response.status}`, errorText)) { urlIndex--; continue; }

        // A skip-rule matched this HTTP failure → abandon this account now; do NOT
        // fall through to shouldRetry()/other base URLs on the same account. The
        // response is returned to the caller unchanged. Reachability note: this
        // fires only when a caller passes `requestPolicy.skipRules` into execute().
        // The account layer (chatCore/chat.js, outside this port's named files)
        // re-matches via matchSkipRule/findMatchingSkipRule to read `sweep` and
        // decide whether to re-try the whole pool.
        if (matchedSkip({ statusKey: response.status, errorKind: `http_${response.status}`, text: errorText })) {
          return {
            response,
            url,
            headers,
            transformedBody: requestBody,
            attemptStartedAt: providerAttemptStartedAt,
            terminalProvenance: "upstream",
          };
        }

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
        // Prove OUR timer fired by reason identity (mergedSignal.reason ===
        // connectCtrl's reason). connectCtrl.signal.aborted alone would
        // misclassify a caller-first abort when the timer fires before the
        // fetch rejection reaches this catch; the reason on the merged signal
        // is whichever fired FIRST, so identity is authoritative.
        const isConnectTimeout = connectCtrl.signal.aborted &&
          mergedSignal?.reason === connectCtrl.signal.reason;
        // Classify: our header-timeout vs a caller-initiated abort vs a generic network error.
        const errorKind = isConnectTimeout ? "connect_timeout" : "network";
        dbg("FETCH", `${this.provider.toUpperCase()} ✖ ${error.name}: ${error.message}${isConnectTimeout ? " (connect timeout)" : ""}`);
        // A caller-initiated abort (signal aborted but NOT our connect timer) must propagate.
        if (!isConnectTimeout && (error.name === "AbortError" || signal?.aborted)) {
          error.errorKind = "aborted";
          error.providerAttemptStartedAt = providerAttemptStartedAt;
          throw error;
        }

        // connect_timeout / network → retryable per resolveAttempts (default: connect_timeout=0 retries)
        if (await tryRetry(urlIndex, HTTP_STATUS.BAD_GATEWAY, `${errorKind} "${error.message}"`, null, errorKind, error.message)) { urlIndex--; continue; }

        // A skip-rule matched this exception → abandon this account now; do NOT cycle
        // the remaining base URLs on the same account. Fires only when a caller
        // passes requestPolicy.skipRules into execute() (account layer wires that).
        if (matchedSkip({ statusKey: HTTP_STATUS.BAD_GATEWAY, errorKind, text: error.message })) {
          error.errorKind = errorKind;
          error.providerAttemptStartedAt = providerAttemptStartedAt;
          throw error;
        }

        if (urlIndex + 1 < fallbackCount) {
          log?.debug?.("RETRY", `Error on ${url}, trying fallback ${urlIndex + 1}`);
          continue;
        }
        error.errorKind = errorKind;
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
