import { projectProviderCredentials, markAccountUnavailable, clearAccountError } from "../../../services/auth.js";
import { antigravityHealth, healthEnabled, trackHealthResponse } from "open-sse/services/antigravityHealth.js";
import { runWithConnectionRecovery } from "@/lib/routing/connectionRecovery.js";
import { resolveFallbackModelScope } from "open-sse/services/fallbackScope.js";
import { getSettings, updateProviderConnection } from "@/lib/localDb";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendHeadroomEvent } from "@/lib/headroom/events.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { EMPTY_CONTENT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { isDurableCredentialProvider } from "open-sse/services/accountFallback.js";
import { updateProviderCredentials } from "../../../services/tokenRefresh.js";
import { refreshAndUpdateCredentials } from "@/shared/services/providerCredentials";
import { providerRefreshContext } from "@/shared/utils/providerCredentialContext";
import { allocateProviderAttemptTimestamp } from "@/shared/services/providerRateLimitEvidence";
import { createQuotaReservationLifecycle } from "@/shared/services/quotaSelection";
import { isString } from "../../../../shared/utils/typeChecks.js";
import * as log from "../../../utils/logger.js";
import { requestAborted } from "../shared.js";
import { proceed, proxyOptionsFromCredentials, RETRY, terminal } from "./context.js";
import { onProviderRequestSuccess } from "./providerHooks.js";

/**
 * Build the handleChatCore options for one account attempt. Credential refresh
 * and rotation callbacks write back into `attempt` so later stages see the
 * connection and credentials the upstream finally accepted.
 */
function buildChatCoreOptions(ctx, state, attempt, { chatSettings, providerThinking, pxpipeTransform, quotaReservation, cookieRefreshContext }) {
  const { provider, model, request, requestSignal, comboRouting } = ctx;
  const { credentials, dispatchedCredential } = attempt;
  // The conversation moved here from an account that already received it in this request.
  const accountSwitched = Boolean(state.sentConnectionId) && state.sentConnectionId !== credentials.connectionId;
  return {
    accountSwitched,
    body: { ...structuredClone(ctx.body), model: `${provider}/${model}` },
    modelInfo: { provider, model },
    modelCapabilities: ctx.resolvedModelCapabilities,
    credentials: attempt.refreshedCredentials,
    log,
    clientRawRequest: ctx.clientRawRequest,
    connectionId: credentials.connectionId,
    userAgent: ctx.userAgent,
    apiKey: ctx.apiKey,
    apiKeyId: ctx.apiKeyId,
    apiKeyName: ctx.apiKeyName,
    billingEpoch: ctx.billingEpoch,
    abortSignal: requestSignal,
    // #747: outer-combo attribution; nested merge narrowed eligibility
    // (comboRouting.allowedConnectionIds) without changing attribution.
    comboId: comboRouting?.id || null,
    comboName: comboRouting?.name || null,
    comboNoLog: comboRouting?.noLog === true,
    quotaReservation,
    onProviderAttempt: () => {
      state.accountAttempts++;
      state.sentConnectionId = credentials.connectionId;
      attempt.latestAttemptStartedAt = allocateProviderAttemptTimestamp();
      return attempt.latestAttemptStartedAt;
    },
    ccFilterNaming: !!chatSettings.ccFilterNaming,
    rtkEnabled: !!chatSettings.rtkEnabled,
    headroomEnabled: !!chatSettings.headroomEnabled,
    headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
    headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
    headroomTimeoutMs: chatSettings.headroomTimeoutMs,
    pxpipeEnabled: !!chatSettings.pxpipeEnabled,
    cavemanEnabled: !!chatSettings.cavemanEnabled,
    cavemanLevel: chatSettings.cavemanLevel || "full",
    ponytailEnabled: !!chatSettings.ponytailEnabled,
    ponytailLevel: chatSettings.ponytailLevel || "full",
    customPromptEnabled: !!chatSettings.customPromptEnabled,
    customPrompt: chatSettings.customPrompt || "",
    comboPrompts: ctx.comboPrompts,
    pxpipeMinChars: chatSettings.pxpipeMinChars,
    pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
    pxpipeTransform,
    pxpipeAllowedModels: chatSettings.pxpipeAllowedModels,
    onPxpipeEvent: appendPxpipeEvent,
    onHeadroomEvent: appendHeadroomEvent,
    onTokenSaverEvent: (event) => {
      if (ctx.tokenSaverCollector) {
        ctx.tokenSaverCollector.latest = event;
      } else {
        state.lastTokenSaverEvent = event;
      }
    },
    providerThinking,
    routingPolicy: chatSettings.openrouterRouting,
    providerConcurrencyLimit: chatSettings.providerConcurrencyLimits,
    globalConcurrentRequests: chatSettings.globalConcurrentRequests,
    claudeClassifierCompat: ["off", "auto", "always"].includes(chatSettings.claudeClassifierCompat) ?
    chatSettings.claudeClassifierCompat :
    "off",
    compressionEnabled: !!chatSettings.compressionEnabled,
    compressionEngines: chatSettings.compressionEngines || {},
    contentMasking: chatSettings.contentMasking ?? null,
    compressionFidelityGate: chatSettings.compressionFidelityGate === true,
    compressionAdaptive: chatSettings.compressionAdaptive ?? null,
    // Detect source format by endpoint + body
    sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, ctx.body) : null,
    // A durable credential (OrcaRouter) has nothing to refresh: injecting the
    // refresher would hand chatCore the same rejected key to retry.
    ...(attempt.activeConnection?.authType === "oauth" && !isDurableCredentialProvider(attempt.activeConnection.provider) ? {
      refreshCredentials: async ({ signal, force = true } = {}) => {
        const refreshed = await refreshAndUpdateCredentials(
          attempt.activeConnection,
          force,
          proxyOptionsFromCredentials(attempt.refreshedCredentials),
          { signal, log }
        );
        attempt.activeConnection = refreshed.connection;
        attempt.refreshedCredentials = await projectProviderCredentials(attempt.activeConnection, credentials._quotaPreflight);
        return attempt.refreshedCredentials;
      }
    } : null),
    // Non-OAuth sessions that rotate their own credentials report them here.
    // kimi-web returns a new token pair plus `providerSpecificPatch`; keep it
    // in the encrypted token columns so the next request and a restart start
    // from it. Web-cookie executors (chatgpt-web) hand back a rotated session
    // cookie as `apiKey`. PromptQL saves its derived credentials against the
    // sending cookie so a concurrent re-import cannot receive a stale token.
    ...(attempt.activeConnection && attempt.activeConnection.authType !== "oauth" ? {
      onCredentialsRefreshed: async (next) => {
        if (provider === "promptql" && cookieRefreshContext && next?.promptqlSession) {
          return updateProviderConnection(credentials.connectionId, {
            accessToken: next.accessToken,
            providerSpecificData: next.promptqlSession
          }, { expectedRefreshContext: cookieRefreshContext });
        }
        if (next?.providerSpecificPatch) {
          await updateProviderCredentials(credentials.connectionId, {
            accessToken: next.accessToken,
            refreshToken: next.refreshToken,
            providerSpecificData: next.providerSpecificPatch,
            existingProviderSpecificData: attempt.activeConnection.providerSpecificData
          });
          return;
        }
        const rotated = next?.apiKey;
        if (!cookieRefreshContext || !isString(rotated) || !rotated) return;
        if (rotated === cookieRefreshContext.apiKey) return;
        return updateProviderCredentials(credentials.connectionId, { rotatedApiKey: rotated }, {
          expectedRefreshContext: cookieRefreshContext
        });
      }
    } : null),
    onRequestSuccess: async ({ attemptStartedAt = attempt.latestAttemptStartedAt } = {}) => {
      onProviderRequestSuccess(provider, credentials.connectionId, model);
      if (!Number.isSafeInteger(attemptStartedAt) || attemptStartedAt <= 0) return;
      await clearAccountError(credentials.connectionId, attempt.refreshedCredentials, model, {
        provider,
        attemptStartedAt,
        credentialFingerprint: dispatchedCredential,
        signal: requestSignal
      });
    },
    // Streaming headers are already committed when emptiness becomes known.
    // Bench this account so the client's retry selects another candidate.
    onEmptyStream: async () => {
      if (!Number.isSafeInteger(attempt.latestAttemptStartedAt) || attempt.latestAttemptStartedAt <= 0) return;
      await markAccountUnavailable(
        credentials.connectionId,
        HTTP_STATUS.BAD_GATEWAY,
        `Empty streaming response from ${provider}/${model}`,
        provider,
        model,
        Date.now() + EMPTY_CONTENT_COOLDOWN_MS,
        { attemptStartedAt: attempt.latestAttemptStartedAt, credentialFingerprint: dispatchedCredential, signal: requestSignal }
      );
    },
    // Empty-stream retries exhausted mid-stream (headers already sent, so no
    // pre-stream fallback is possible): bench the account so the client's
    // automatic retry of the in-stream error lands on the next one. Quota
    // exhaustion passes a precise resetsAtMs instead of the generic cooldown.
    onUpstreamEmptyExhausted: async (reason, resetsAtMs, status = HTTP_STATUS.BAD_GATEWAY) => {
      if (!Number.isSafeInteger(attempt.latestAttemptStartedAt) || attempt.latestAttemptStartedAt <= 0) return;
      await markAccountUnavailable(credentials.connectionId, status, reason, provider, model, resetsAtMs, {
        attemptStartedAt: attempt.latestAttemptStartedAt,
        credentialFingerprint: dispatchedCredential,
        signal: requestSignal
      });
    }
  };
}

/**
 * Stage 4: dispatch one account attempt through the shared chatCore. Loads
 * settings, reserves quota, tracks Antigravity health and returns
 * ok({ result }), a terminal response, or RETRY when the account was skipped.
 */
export async function dispatchAttempt(ctx, state, attempt) {
  const { provider, model, request, requestSignal, preferredConnectionId } = ctx;
  const { credentials, activeConnection, refreshedCredentials } = attempt;

  // Use shared chatCore
  const chatSettings = await getSettings();
  attempt.chatSettings = chatSettings;
  if (requestAborted(request, requestSignal)) return terminal(errorResponse(499, "Request aborted"));
  const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
  const pxpipeTransform = chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null;
  if (requestAborted(request, requestSignal)) return terminal(errorResponse(499, "Request aborted"));
  const quotaReservation = createQuotaReservationLifecycle({
    quotaProfile: credentials._quotaPreflight?.quotaProfile || null,
    connectionId: credentials.connectionId,
    provider,
    routeKey: `${provider}/${model}`,
    config: chatSettings.quotaSelection || {}
  });
  const cookieRefreshContext = activeConnection?.authType === "cookie"
    ? providerRefreshContext({
      id: refreshedCredentials.connectionId,
      provider: activeConnection.provider,
      authType: activeConnection.authType,
      apiKey: refreshedCredentials.apiKey,
      providerSpecificData: refreshedCredentials.providerSpecificData
    })
    : null;
  const healthAttempt = model && healthEnabled(provider, chatSettings) ? antigravityHealth.begin(credentials.connectionId, state.upstreamModel || model, true) : null;
  attempt.healthAttempt = healthAttempt;
  if (model && healthEnabled(provider, chatSettings) && !healthAttempt) {
    if (preferredConnectionId) return terminal(errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "Connection recovery in progress"));
    state.excludeConnectionIds.add(credentials.connectionId);
    return RETRY;
  }
  const cancelHealthAttempt = () => healthAttempt?.finish("ignored");
  requestSignal?.addEventListener("abort", cancelHealthAttempt, { once: true });
  if (requestSignal?.aborted) cancelHealthAttempt();
  let result;
  try {
    result = await runWithConnectionRecovery(
      handleChatCore,
      buildChatCoreOptions(ctx, state, attempt, { chatSettings, providerThinking, pxpipeTransform, quotaReservation, cookieRefreshContext }),
      activeConnection,
      model,
      resolveFallbackModelScope(provider, model),
      requestSignal
    );
  } catch (error) {
    cancelHealthAttempt();
    throw error;
  } finally {
    requestSignal?.removeEventListener("abort", cancelHealthAttempt);
  }
  if (result.success) result.response = trackHealthResponse(result.response, healthAttempt, requestSignal);
  else healthAttempt?.finish(!requestAborted(request, requestSignal) && result.antigravityPreResponseTimeout === true ? "timeout" : "ignored");
  return proceed({ result });
}
