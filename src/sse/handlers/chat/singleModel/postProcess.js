import { markAccountUnavailable } from "../../../services/auth.js";
import { withRouteResponseHeaders } from "open-sse/utils/routeResponseHeaders.js";
import { validateProviderRequestId } from "../../../utils/requestCorrelation.js";
import { isLocalStreamLifecycleError, isRequestScopedStreamError } from "open-sse/utils/streamLifecycle.js";
import { peekStreamForContent } from "open-sse/utils/streamContentPeek.js";
import { HTTP_STATUS, STREAM_EARLY_EOF_PEEK_MS } from "open-sse/config/runtimeConfig.js";
import { isRequestReplayBufferError } from "open-sse/services/accountFallback.js";
import { isObject, isString } from "../../../../shared/utils/typeChecks.js";
import * as log from "../../../utils/logger.js";
import { requestAborted } from "../shared.js";
import { RETRY, terminal } from "./context.js";
import { antigravityPreResponseTimeout, evaluateProviderFailure } from "./providerHooks.js";

/**
 * Peek a successful single-model stream for its first content frame
 * (OmniRoute #13153/#13630). `failed` is true when the stream ended or errored
 * before any content reached the client and the failure was not
 * request-scoped (OmniRoute #14585: a sibling would reject the same request).
 * The returned response always replays the consumed bytes, so passing it on
 * is identical to the original stream. Content already sent is never retried:
 * nothing is forwarded until the peek settles.
 *
 * This sits inside the account loop, below the transient 5xx retry wrapper
 * (runWithTransientBackendRetry). The held response is a 200 stream, so an
 * early EOF never multiplies into whole-request retries.
 *
 * @param {Response} response
 * @param {number} [peekMs] peek window; 0 disables the hold
 * @returns {Promise<{response: Response, failed: boolean}>}
 */
export async function holdForEarlyEof(response, peekMs = STREAM_EARLY_EOF_PEEK_MS) {
  if (peekMs <= 0) return { response, failed: false };
  const peek = await peekStreamForContent(response, peekMs);
  if (!peek.body) return { response, failed: false };
  const replay = new Response(peek.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
  const failed = (peek.outcome === "empty" || peek.outcome === "error") &&
  !isRequestScopedStreamError(peek.streamError);
  return { response: replay, failed };
}

async function handleSuccess(ctx, state, attempt, result) {
  const { provider, model, request, requestSignal, preferredConnectionId } = ctx;
  const { credentials } = attempt;
  const headerOptions = { provider, model, attempts: Math.max(1, state.accountAttempts) };
  if (result.claudeFast) {
    const response = withRouteResponseHeaders(result.response, headerOptions);
    response.claudeFast = true;
    return terminal(response);
  }
  if (state.earlyEofOriginal || preferredConnectionId) return terminal(withRouteResponseHeaders(result.response, headerOptions));
  const held = await holdForEarlyEof(result.response);
  if (!held.failed || requestAborted(request, requestSignal)) return terminal(withRouteResponseHeaders(held.response, { provider, model, attempts: Math.max(1, state.accountAttempts) }));
  log.warn("STREAM", `[${provider}/${model}] ACC:${credentials.connectionId.slice(0, 8)} stream ended before any content; trying one sibling`);
  state.earlyEofOriginal = held.response;
  state.excludeConnectionIds.add(credentials.connectionId);
  return RETRY;
}

/** Copy the upstream request id onto the client response so support can trace it. */
function attachUpstreamRequestId(state, result) {
  const upstreamRequestId = ["x-request-id", "request-id", "x-correlation-id"]
    .map((name) => validateProviderRequestId(new Headers(result.headers || {}).get(name)))
    .find(Boolean);
  if (!upstreamRequestId) return;
  const responseHeaders = new Headers(result.response.headers);
  responseHeaders.set("x-upstream-request-id", upstreamRequestId);
  result.response = new Response(result.response.body, {
    status: result.response.status,
    statusText: result.response.statusText,
    headers: responseHeaders,
  });
  if (state.antigravityTimeoutResponse) result.response.skipAntigravityTimeoutReplay = true;
}

/**
 * Stage 5: post-process one attempt's result. Success is returned (after the
 * early-EOF peek); terminal and request-scoped failures are returned as-is;
 * retryable failures cool the account down and RETRY with the next one.
 */
export async function processAttemptResult(ctx, state, attempt, result) {
  const { provider, model, request, requestSignal, preferredConnectionId, comboRouting } = ctx;
  const { credentials } = attempt;

  if (result.connectionRecoveryBusy) {
    if (preferredConnectionId) {
      result.response.localAdmissionRejected = true;
      return terminal(result.response);
    }
    state.excludeConnectionIds.add(credentials.connectionId);
    return RETRY;
  }

  if (result.success) return handleSuccess(ctx, state, attempt, result);
  if (result.claudeRequestScoped) {
    result.response.claudeRequestScoped = true;
    return terminal(result.response);
  }
  if (state.antigravityTimeoutResponse) result.response.skipAntigravityTimeoutReplay = true;
  // Process-local admission pressure is terminal for this request. Retrying a
  // sibling would hit the same queue and must not cool a healthy account.
  if (result.localSchemaError === true) return terminal(result.response);
  if (result.localAdmissionRejected === true) {
    // Keep explicit locality on the Response across the outer transient retry.
    result.response.localAdmissionRejected = true;
    return terminal(result.response);
  }
  // A client-side abort (named AbortError, or a bare request_signal_aborted /
  // "Client disconnected" / "operation was aborted" that defaulted to 502) is a
  // local stream lifecycle event, NOT a provider failure. Return without cooling
  // down the account or accruing fallback state (OmniRoute #7907/#7908).
  if (requestAborted(request, requestSignal) || result.status === 499 || isLocalStreamLifecycleError(result.error)) return terminal(result.response);
  if (antigravityPreResponseTimeout(provider, result)) {
    // Internal metadata stays on the Response, never in the client payload.
    result.response.skipAntigravityTimeoutReplay = true;
    if (preferredConnectionId) return terminal(result.response);
    state.antigravityTimeoutResponse ??= result.response;
    state.requestReplayConnectionId = null;
    state.excludeConnectionIds.add(credentials.connectionId);
    state.lastError = result.error;
    state.lastStatus = result.status;
    state.lastErrorCode = null;
    return RETRY;
  }
  if (!state.requestReplayAttempted && isRequestReplayBufferError(result.status, result.error)) {
    state.requestReplayAttempted = true;
    state.requestReplayConnectionId = credentials.connectionId;
    state.attemptCounts.delete(credentials.connectionId);
    log.warn("RETRY", `ACC:${credentials.connectionName} replaying once after upstream request-buffer overflow`);
    return RETRY;
  }
  // Preserve a backend error after generated output; replay could repeat tools.
  if (result.upstreamPartialOutput === true) return terminal(result.response);
  if (preferredConnectionId) {
    // A pinned connection must not rotate. Return the failure response immediately.
    log.warn("CHAT", `[${provider}/${model}] pinned connection ${preferredConnectionId.slice(0, 8)} failed; pin is terminal`);
    return terminal(result.response);
  }
  if (result.quotaCapacityUnavailable) {
    // A local atomic-capacity race is not provider evidence. Release/expiry is
    // owned by the lifecycle; exclude this account and try a sibling without
    // writing a synthetic 429 or breaker state.
    state.excludeConnectionIds.add(credentials.connectionId);
    state.lastError = "Provider quota capacity unavailable";
    state.lastStatus = HTTP_STATUS.SERVICE_UNAVAILABLE;
    state.lastErrorCode = null;
    return RETRY;
  }

  const resultAttemptStartedAt = Number.isSafeInteger(result.attemptStartedAt) && result.attemptStartedAt > 0 ?
  result.attemptStartedAt :
  attempt.latestAttemptStartedAt;
  const resultErrorBody = result.errorBody && isObject(result.errorBody) ? result.errorBody : null;
  const resultHeaders = result.headers ?? null;
  attachUpstreamRequestId(state, result);

  const failure = await evaluateProviderFailure(ctx, state, attempt, result, resultErrorBody);
  if (failure.kind !== "ok") return failure;
  const { fallbackResetAt, fallbackEvidence } = failure;

  const fallbackState = await markAccountUnavailable(
    credentials.connectionId,
    result.status,
    result.error,
    provider,
    model,
    fallbackResetAt,
    {
      attemptStartedAt: resultAttemptStartedAt,
      rateLimitEvidence: fallbackEvidence,
      headers: resultHeaders,
      errorBody: resultErrorBody,
      // The credential this attempt actually presented, so a durable-key
      // provider can mark exactly the generation that was rejected.
      usedCredential: credentials.accessToken || credentials.apiKey || null,
      credentialFingerprint: attempt.dispatchedCredential,
      // Proven relay/hop provenance from the fork's own transport layer.
      // Null for an ordinary upstream HTTP response, which is a provider
      // answer rather than a hop failure.
      transportFailure: result.transportFailure ?? null,
      // Accounts this request already excluded cannot serve it again, so
      // they are not alternatives for the cooldown decision.
      excludedConnectionIds: state.excludeConnectionIds,
      hasComboFallback: comboRouting !== null,
      signal: requestSignal
    }
  );
  const { shouldFallback } = fallbackState;

  if (shouldFallback) {
    state.attemptedBlockers.set(credentials.connectionId, {
      status: Number(result.status) || 503,
      retryAt: fallbackState.retryAt || null,
      retryAtKnown: fallbackState.retryAtKnown !== false
    });
    log.warn("FALLBACK", `⇄ ACC:${credentials.connectionId.slice(0, 8)} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
    state.excludeConnectionIds.add(credentials.connectionId);
    state.lastError = result.error;
    state.lastStatus = result.status;
    const upstreamCode = resultErrorBody?.error?.code;
    state.lastErrorCode = isString(upstreamCode) && upstreamCode ? upstreamCode : null;
    return RETRY;
  }

  return terminal(result.response);
}
