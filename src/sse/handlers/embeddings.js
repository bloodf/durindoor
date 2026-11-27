import { credentialDispatchSnapshot } from "@/shared/utils/credentialFingerprint.js";
import { captureRequestBillingEpoch, getRequestId, withRequestCorrelation } from "../utils/requestCorrelation.js";
import { clearAccountError } from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { handleEmbeddingsCore } from "open-sse/handlers/embeddingsCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { leasedAntigravityRefresher } from "./media/antigravityRefresh.js";
import { recordAcceptedJobUsage, recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";
import { wantsDefaultRoute, resolveMediaRoute } from "../services/mediaRoutes.js";
import { resolveTypedMediaModel, runMediaAccounts, runMediaEndpoint } from "./media/pipeline.js";

// combo.js ACCEPTED_JOB_HEADER: an accepted or uncertain submit stops every
// fallback. Kept local so this route does not load the combo engine.
const ACCEPTED_JOB_HEADER = "x-durindoor-accepted-job";

/**
 * Handle embeddings request for the SSE/Next.js server.
 * Follows the same auth + fallback pattern as handleChat.
 * Records complete core accounting without reinterpreting provider provenance.
 * Adapter-synthesized zero usage cannot establish a free provider charge.
 *
 * @param {Request} request
 */
async function handleEmbeddingsHandler(request) {
  await captureRequestBillingEpoch(request);
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("EMBEDDINGS", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  let modelStr = body.model;

  log.request("POST", `${url.pathname} | ${modelStr}`);

  return runMediaEndpoint(request, {
    kind: "embeddings",
    pinConnection: true,
    route: (admission, pinOptions) => routeEmbeddings(request, body, modelStr, admission, pinOptions),
  });
}

async function routeEmbeddings(request, body, modelStr, { settings, apiKey, auth: apiKeyAuth }, pinOptions) {
  // Keep the admission epoch, including null, across upstream retries.
  const { billingEpoch } = apiKeyAuth;
  if (apiKey) {
    log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }
  if (!body.input) {
    log.warn("EMBEDDINGS", "Missing input");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");
  }

  // No model: the embeddings route's first model (embeddings never switch
  // models mid-route; account fallback below still applies).
  if (wantsDefaultRoute(modelStr)) {
    const route = await resolveMediaRoute("embedding", { settings, apiKeyId: apiKeyAuth.apiKeyId });
    if (route.error) return route.error;
    modelStr = route.models[0];
  }

  const modelInfo = await resolveTypedMediaModel(request, modelStr, body, apiKey, "embedding");
  if (modelInfo.error) {
    return modelInfo.error;
  }

  const { provider, model } = modelInfo;

  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  const usageEventId = (credentials) => JSON.stringify([getRequestId(request), "embedding", provider, model, credentials.connectionId ?? null]);
  /** A submit the provider may have billed without a usable answer (DeepInfra
   * native). It is recorded once on the account that sent it, with the
   * provider's receipt when one exists, and never replayed on another account,
   * model or combo member.
   */
  const recordAccepted = async (result, credentials) => {
    await recordAcceptedJobUsage(apiKey, {
      ...result.acceptedJob,
      billingEpoch,
      usageEventId: usageEventId(credentials), provider, model,
      connectionId: credentials.connectionId ?? null, endpoint: "/v1/embeddings",
      modality: "embedding",
      apiKeyId: apiKeyAuth.apiKeyId,
    });
    const response = result.response || errorResponse(result.status, result.error);
    const headers = new Headers(response.headers);
    headers.set(ACCEPTED_JOB_HEADER, "1");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };

  return runMediaAccounts({
    provider, model,
    selectionOptions: { ...pinOptions, apiKeyId: apiKeyAuth.apiKeyId },
    buildExhaustedResponse(credentials, { lastError, lastStatus, attempted }) {
      if (credentials?.providerDisabled) {
        log.warn("EMBEDDINGS", `[${provider}/${model}] free no-auth provider disabled by settings`);
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
      }
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("EMBEDDINGS", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (attempted === 0) {
        log.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      log.warn("EMBEDDINGS", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    },
    async runAttempt(credentials) {
    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    const dispatch = credentialDispatchSnapshot(refreshedCredentials);
    // Cores and executors mutate the dispatched credentials before the callback runs.
    const presentedRefreshToken = refreshedCredentials.refreshToken;
    // Without a sent refresh token there is nothing to guard against.
    const refreshGuard = presentedRefreshToken ? [{ presentedRefreshToken }] : [];
    const result = await handleEmbeddingsCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      routingPolicy: (await getSettings()).openrouterRouting,
      credentials: refreshedCredentials,
      signal: request.signal,
      log,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        }, ...refreshGuard);
      },
      refreshCredentials: leasedAntigravityRefresher(refreshedCredentials),
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model, dispatch);
      }
    });

    if (result.success) {
      if (result.accounting?.state !== "complete") return { response: result.response };
      const { modality, tokens, nativeUnits, cost, costStatus, costSource, meta } = result.accounting;
      return { response: await recordApiKeyUsageForResponse(apiKey, result.response, {
        billingEpoch,
        usageEventId: usageEventId(credentials), provider, model,
        connectionId: credentials.connectionId ?? null, endpoint: "/v1/embeddings",
        modality, tokens, nativeUnits, cost, costStatus, costSource, meta,
        // The stable id of the admitted key travels with the usage.
        apiKeyId: apiKeyAuth.apiKeyId,
      }) };
    }
    if (request.signal?.aborted && result.acceptedJob) return { response: await recordAccepted(result, credentials) };
    return {
      result, dispatch, resetAt: result.resetsAtMs ?? null,
      failureContext: {
        ...(result.rateLimitEvidence ? { rateLimitEvidence: result.rateLimitEvidence } : null),
        ...(result.quotaExhausted === true ? { quotaExhausted: true } : null),
      },
    };
    },
    onAttemptResult(result, credentials) {
      if (result.status !== 499) return null;
      return result.acceptedJob ? recordAccepted(result, credentials) : result.response;
    },
    onAccountFailure: (result, credentials) => (result.acceptedJob ? recordAccepted(result, credentials) : null),
    onFallback(result, credentials) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
    }
  });
}
export const handleEmbeddings = withRequestCorrelation(handleEmbeddingsHandler);
