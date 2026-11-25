import { credentialDispatchSnapshot } from "@/shared/utils/credentialFingerprint.js";
import { getRequestId, withRequestCorrelation } from "../utils/requestCorrelation.js";
import {
  getNoAuthProviderCredentials,
  clearAccountError,
} from "../services/auth.js";
import { handleModerationsCore } from "open-sse/handlers/moderationsCore.js";
import { runWithModelFallback } from "open-sse/services/modelFallback.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { toExecutorCredentials } from "./typeHelpers.js";
import { recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";
import { resolveTypedMediaModel, runMediaAccounts, runMediaEndpoint } from "./media/pipeline.js";

/**
 * Handle moderations request — OpenAI-compatible /v1/moderations passthrough.
 * Follows the same auth + fallback pattern as handleChat/handleEmbeddings and
 * forwards request.signal without cooling down accounts on client abort.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleModerationsHandler(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const modelStr = body.model;

  log.request("POST", `${url.pathname} | ${modelStr}`);

  // Moderation historically ignores x-connection-id, including model fallbacks.
  return runMediaEndpoint(request, {
    kind: "moderations",
    route: (admission) => routeModerations(request, body, modelStr, url, admission),
  });
}

async function routeModerations(request, body, modelStr, url, { settings, apiKey, auth: apiKeyAuth }) {
  if (apiKey) {
    log.debug("AUTH", "API key provided");
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }
  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!body.input) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");

  // Model and account fallbacks retain the original admission epoch.
  const usageContext = { billingEpoch: apiKeyAuth.billingEpoch, usageEventId: `${getRequestId(request)}:${url.pathname}`, endpoint: url.pathname };
  return runWithModelFallback(
    modelStr,
    settings.modelFallbacks,
    (m) => handleSingleModelModeration(m, body, request, apiKey, apiKeyAuth.apiKeyId, usageContext),
    log
  );
}

async function handleSingleModelModeration(modelStr, body, request, apiKey, apiKeyId, usageContext) {
  if (request.signal?.aborted) {
    return errorResponse(499, "Moderation request aborted");
  }
  const modelInfo = await resolveTypedMediaModel(request, modelStr, body, apiKey, "moderation");
  if (modelInfo.error) return modelInfo.error;

  const { provider, model } = modelInfo;
  /** Record the core receipt without consuming the response or assuming free service. */
  const recordSuccess = (result, credentials) => recordApiKeyUsageForResponse(apiKey, result.response, {
    ...result.accounting,
    ...usageContext,
    provider,
    model,
    connectionId: credentials.connectionId || null,
    modality: "moderation",
    // The stable id of the admitted key travels with the usage.
    apiKeyId,
  });

  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  // noAuth executors still resolve provider-account scope before dispatch.
  const { getExecutor } = await import("open-sse/executors/index.js");
  const executor = getExecutor(provider);
  if (executor?.noAuth) {
    const credentials = await getNoAuthProviderCredentials(provider, model, { apiKeyId });
    if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
      if (credentials?.providerDisabled) {
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
      }
      return errorResponse(
        credentials?.allRateLimited ? Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE : HTTP_STATUS.BAD_REQUEST,
        credentials?.lastError || `No credentials for provider: ${provider}`,
      );
    }
    const result = await handleModerationsCore({ body, modelInfo: { provider, model }, credentials, log, signal: request.signal, onRequestSuccess: async () => clearAccountError(credentials.connectionId, credentials, model) });
    if (result.success) return recordSuccess(result, credentials);
    if (request.signal?.aborted || result.status === 499) {
      return result.response || errorResponse(499, result.error || "Moderation request aborted");
    }
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Moderation failed");
  }

  return runMediaAccounts({
    provider, model, selectionOptions: { apiKeyId },
    buildExhaustedResponse(credentials, { lastError, lastStatus, attempted }) {
      if (credentials?.providerDisabled) {
        log.warn("MODERATION", `[${provider}/${model}] free no-auth provider disabled by settings`);
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
      }
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("MODERATION", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (attempted === 0) {
        log.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      log.warn("MODERATION", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    },
    async runAttempt(credentials) {
    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(provider, { ...credentials });

    const dispatch = credentialDispatchSnapshot(refreshedCredentials);
    const result = await handleModerationsCore({
      body,
      modelInfo: { provider, model },
      credentials: toExecutorCredentials(refreshedCredentials),
      log,
      signal: request.signal,
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model, dispatch);
      },
    });

    if (result.success) return { response: await recordSuccess(result, credentials) };
    return { result, dispatch };
    },
    onAttemptResult(result) {
      if (result.status === HTTP_STATUS.BAD_REQUEST) return result.response;
      if (request.signal?.aborted || result.status === 499) {
        return result.response || errorResponse(499, result.error || "Moderation request aborted");
      }
      return null;
    },
    onFallback(result, credentials) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
    },
  });
}
export const handleModerations = withRequestCorrelation(handleModerationsHandler);
