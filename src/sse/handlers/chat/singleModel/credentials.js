import { getProviderCredentialsWithQuotaPreflight, projectProviderCredentials } from "../../../services/auth.js";
import { credentialDispatchSnapshot } from "@/shared/utils/credentialFingerprint.js";
import { isRoutableProvider } from "../../../../shared/constants/providers.js";
import { comboPolicyRejection } from "open-sse/services/combo.js";
import { notifyWebhookEvent } from "@/lib/webhooks/index.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { errorResponse, unavailableResponse, getClientStatusFromError } from "open-sse/utils/error.js";
import { refreshAndUpdateCredentials } from "@/shared/services/providerCredentials";
import { isNumber, isString } from "../../../../shared/utils/typeChecks.js";
import * as log from "../../../utils/logger.js";
import { requestAborted } from "../shared.js";
import {
  MAX_ACCOUNT_ATTEMPTS_PER_REQUEST,
  RETRY,
  accountSelectionOptions,
  aggregateRateLimitBlockers,
  proceed,
  proxyOptionsFromCredentials,
  terminal
} from "./context.js";
import {
  ANTIGRAVITY_CAPACITY_SWEEP_RETRIES,
  allowedAttemptsPerConnection,
  antigravityAccountFailover,
  ensureProviderProjectId,
  shouldRestartCapacitySweep,
  warmRequestModelLimits
} from "./providerHooks.js";

function aborted(ctx) {
  return requestAborted(ctx.request, ctx.requestSignal);
}

/** Every configured account is rate-limited, unavailable or the provider is disabled. */
function unavailableOutcome(ctx, state, credentials) {
  const { provider, model } = ctx;
  if (state.antigravityTimeoutResponse && !credentials?.providerDisabled) return terminal(state.antigravityTimeoutResponse);
  if (state.earlyEofOriginal) return terminal(state.earlyEofOriginal);
  if (credentials?.providerDisabled) {
    log.warn("CHAT", `[${provider}/${model}] free no-auth provider disabled by settings`);
    return terminal(errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`));
  }
  if (credentials?.allRateLimited) {
    const rawStatus = credentials.lastErrorCode;
    const parsedStatus = isNumber(rawStatus) || isString(rawStatus) ? Number(rawStatus) : NaN;
    const validStoredStatus = Number.isInteger(parsedStatus) && parsedStatus >= 400 && parsedStatus <= 599;
    const storedStatus = validStoredStatus ? parsedStatus : HTTP_STATUS.SERVICE_UNAVAILABLE;
    const combinedRateLimit = aggregateRateLimitBlockers(state.attemptedBlockers, {
      status: storedStatus,
      retryAt: credentials.retryAfter || null,
      retryAtKnown: Boolean(credentials.retryAfter)
    });
    const status = combinedRateLimit?.status || (
    validStoredStatus && storedStatus !== 429 ? storedStatus : state.lastStatus || storedStatus);
    const errorMsg = status === storedStatus && (validStoredStatus || !state.lastStatus) ?
    credentials.lastError || "Unavailable" :
    state.lastError || credentials.lastError || "Unavailable";
    const retryAfter = combinedRateLimit ? combinedRateLimit.retryAt : credentials.retryAfter;
    log.warn("CHAT", `[${provider}/${model}] all accounts unavailable`);
    notifyWebhookEvent("provider.unavailable", { provider, model, status }, { throttleKey: `${provider}/${model}` });
    return terminal(unavailableResponse(getClientStatusFromError(status, errorMsg), `[${provider}/${model}] ${errorMsg}`, retryAfter, retryAfter ? credentials.retryAfterHuman : ""));
  }
  if (state.excludeConnectionIds.size === 0) {
    // 404 is right either way here, because /v1/models filters on isActive too,
    // so the model genuinely is not in the catalogue. What differs is why.
    if (isRoutableProvider(provider)) {
      log.warn("AUTH", `No active credentials for provider: ${provider}`);
      return terminal(errorResponse(
        HTTP_STATUS.NOT_FOUND,
        `No active credentials for provider: ${provider}. Connect an account for this provider in the dashboard.`,
        { code: "provider_not_configured" },
      ));
    }
    log.warn("AUTH", `Unknown provider: ${provider}`);
    return terminal(errorResponse(
      HTTP_STATUS.NOT_FOUND,
      `Unknown provider "${provider}" in model "${provider}/${model}". See /v1/models for what this router serves.`,
    ));
  }
  if (shouldRestartCapacitySweep(provider, state)) {
    state.antigravityCapacitySweeps += 1;
    log.warn("CHAT", `[${provider}/${model}] all accounts reported capacity; restarting account sweep ${state.antigravityCapacitySweeps}/${ANTIGRAVITY_CAPACITY_SWEEP_RETRIES}`);
    state.excludeConnectionIds.clear();
    return RETRY;
  }
  log.warn("CHAT", "No more accounts available", { provider });
  notifyWebhookEvent("provider.unavailable", { provider, model, status: state.lastStatus || null }, { throttleKey: `${provider}/${model}` });
  return terminal(exhaustedResponse(ctx, state));
}

function exhaustedResponse(ctx, state) {
  const { provider, model } = ctx;
  const attemptedRateLimit = aggregateRateLimitBlockers(state.attemptedBlockers);
  if (attemptedRateLimit) {
    return unavailableResponse(429, `[${provider}/${model}] ${state.lastError || "Rate limit exceeded"}`, attemptedRateLimit.retryAt, "");
  }
  // Without the upstream code the status default applies, and a 401 would read as
  // `invalid_api_key`: "your gateway key is invalid" (OmniRoute #21119).
  return errorResponse(
    getClientStatusFromError(state.lastStatus, state.lastError),
    state.lastError || "All accounts unavailable",
    state.lastErrorCode ? { code: state.lastErrorCode } : null
  );
}

/**
 * Stage 3a: pick the next account. Returns ok({ credentials }), a terminal
 * response (no account left, pin violated, recovery busy) or RETRY.
 */
export async function selectCredentials(ctx, state) {
  const { provider, model, request, requestSignal, preferredConnectionId } = ctx;
  if (aborted(ctx)) return terminal(errorResponse(499, "Request aborted"));
  let credentials;
  try {
    credentials = await getProviderCredentialsWithQuotaPreflight(provider, state.excludeConnectionIds, model, {
      ...accountSelectionOptions(ctx, state),
      sessionId: ctx.routingSessionId,
      preferredConnectionId: preferredConnectionId || state.requestReplayConnectionId,
      reportScopeDenied: ctx.reportComboPolicyRejections
    });
  } catch (error) {
    if (error?.name === "AbortError" || requestAborted(request, requestSignal)) return terminal(errorResponse(499, "Request aborted"));
    throw error;
  }

  if (credentials?.scopeDenied === true) return terminal(comboPolicyRejection());

  // If the caller pinned a connection, the selected credential must match it
  // exactly. Otherwise the account has been excluded/quota-blocked/rotated and
  // the pin is no longer honored.
  if (preferredConnectionId && credentials?.connectionId && credentials.connectionId !== preferredConnectionId) {
    log.warn("CHAT", `[${provider}/${model}] pinned connection ${preferredConnectionId.slice(0, 8)} not selected; refusing rotation`);
    return terminal(errorResponse(HTTP_STATUS.BAD_REQUEST, `Connection ${preferredConnectionId.slice(0, 8)}... is not available for provider '${provider}'.`));
  }

  // All accounts unavailable or provider disabled
  if (credentials?.connectionRecoveryBusy) {
    const response = errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "Connection recovery in progress");
    response.localAdmissionRejected = true;
    return terminal(response);
  }
  if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
    return unavailableOutcome(ctx, state, credentials);
  }

  const allowedAttempts = allowedAttemptsPerConnection(provider);
  const priorAttempts = state.attemptCounts.get(credentials.connectionId) || 0;
  if (priorAttempts >= allowedAttempts || state.totalAttempts >= MAX_ACCOUNT_ATTEMPTS_PER_REQUEST) {
    state.excludeConnectionIds.add(credentials.connectionId);
    if (state.totalAttempts >= MAX_ACCOUNT_ATTEMPTS_PER_REQUEST) {
      if (state.antigravityTimeoutResponse) return terminal(state.antigravityTimeoutResponse);
      if (state.earlyEofOriginal) return terminal(state.earlyEofOriginal);
      log.warn("FALLBACK", "Provider fallback attempt bound reached");
      return terminal(exhaustedResponse(ctx, state));
    }
    return RETRY;
  }
  state.attemptCounts.set(credentials.connectionId, priorAttempts + 1);
  state.totalAttempts += 1;
  return proceed({ credentials });
}

/**
 * Stage 3b: turn the selected account into an attempt. Rotates OAuth tokens
 * through the shared CAS coordinator, fills provider project ids and binds the
 * dispatch snapshot that later outcome writes use.
 */
export async function prepareAttempt(ctx, state, credentials) {
  const { provider, request, requestSignal } = ctx;
  if (aborted(ctx)) return terminal(errorResponse(499, "Request aborted"));

  // Account selection shown in the unified "▶" line (acc:...). OAuth
  // rotation goes through the shared CAS coordinator used by quota refresh.
  let activeConnection = credentials._connection || null;
  let refreshedCredentials = credentials;
  if (activeConnection?.authType === "oauth") {
    try {
      const refreshed = await refreshAndUpdateCredentials(
        activeConnection,
        false,
        proxyOptionsFromCredentials(credentials),
        { signal: requestSignal, log }
      );
      activeConnection = refreshed.connection;
      refreshedCredentials = await projectProviderCredentials(activeConnection, credentials._quotaPreflight);
    } catch (error) {
      if (error?.name === "AbortError") return terminal(errorResponse(499, "Request aborted"));
      log.warn("TOKEN", "Proactive credential refresh failed; attempting existing credential");
    }
  }

  if (requestAborted(request, requestSignal)) return terminal(errorResponse(499, "Request aborted"));

  const projectOutcome = await ensureProviderProjectId(ctx, state, credentials, refreshedCredentials);
  if (projectOutcome.kind !== "ok") return projectOutcome;
  if (requestAborted(request, requestSignal)) return terminal(errorResponse(499, "Request aborted"));
  const accountFailoverAvailable = await antigravityAccountFailover(ctx, state, credentials);
  if (requestAborted(request, requestSignal)) return terminal(errorResponse(499, "Request aborted"));
  warmRequestModelLimits(provider, refreshedCredentials);
  // Bind later outcome writes to the stored credential this attempt sends.
  const { credentialFingerprint: dispatchedCredential } = credentialDispatchSnapshot(refreshedCredentials);
  return proceed({
    attempt: {
      credentials,
      activeConnection,
      refreshedCredentials,
      dispatchedCredential,
      accountFailoverAvailable,
      chatSettings: null,
      latestAttemptStartedAt: null,
      healthAttempt: null
    }
  });
}
