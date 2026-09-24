import { withRequestCorrelation } from "../utils/requestCorrelation.js";
import {
  getProviderCredentialsWithQuotaPreflight,
  getNoAuthProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  resolveClientApiKey,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleSystemoneCore } from "open-sse/handlers/systemoneCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { toExecutorCredentials, toCoreResult } from "./typeHelpers.js";
import { enforceApiKeyModelPolicy, recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";
import { isObject } from "../../shared/utils/typeChecks.js";

/**
 * Handle System One (Jev) decision requests — native /v1/systemone passthrough.
 * Follows the same auth + fallback pattern as handleRerank/handleEmbeddings.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleSystemoneHandler(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("SYSTEMONE", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const modelStr = body.model;
  log.request("POST", `${url.pathname} | ${modelStr}`);

  const settings = await getSettings();
  const { apiKey, auth: apiKeyAuth } = await resolveClientApiKey(request, {
    required: settings.requireApiKey === true,
  });
  if (apiKey) {
    log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }
  if (!apiKeyAuth.ok) {
    if (apiKeyAuth.reason === "missing") {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    log.warn("AUTH", "Invalid API key");
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  if (!modelStr) {
    log.warn("SYSTEMONE", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }
  if (body.state === undefined || body.state === null) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: state");
  }
  if (!body.questions || !isObject(body.questions) || Array.isArray(body.questions)) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: questions");
  }

  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    log.warn("SYSTEMONE", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;
  const resolvedPolicyError = await enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey);
  if (resolvedPolicyError) return resolvedPolicyError;
  const estimatedTokens = (String(body.state).length + JSON.stringify(body.questions).length) / 4;

  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  const { getExecutor } = await import("open-sse/executors/index.js");
  const executor = getExecutor(provider);
  if (executor?.noAuth) {
    const credentials = await getNoAuthProviderCredentials(provider, model, { apiKeyId: apiKeyAuth.apiKeyId });
    if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
      if (credentials?.providerDisabled) {
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
      }
      return errorResponse(
        credentials?.allRateLimited ? Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE : HTTP_STATUS.BAD_REQUEST,
        credentials?.lastError || `No credentials for provider: ${provider}`,
      );
    }
    const result = toCoreResult(
      await handleSystemoneCore({ body, modelInfo: { provider, model }, credentials, log }),
      "System One request failed",
    );
    if (result.success) return recordApiKeyUsageForResponse(apiKey, result.response, { tokens: estimatedTokens, cost: 0 });
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "System One request failed");
  }

  // Credential + fallback loop (mirrors handleRerank). The dashboard example
  // sends x-connection-id for the selected connection; a pinned request uses
  // only that connection (strict), so it never reaches another host or key.
  const pin = request.headers.get("x-connection-id") || null;
  const pinOptions = pin ? { preferredConnectionId: pin, strictConnectionId: pin } : {};
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentialsWithQuotaPreflight(provider, excludeConnectionIds, model, { ...pinOptions, apiKeyId: apiKeyAuth.apiKeyId });

    if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
      if (credentials?.providerDisabled) {
        log.warn("SYSTEMONE", `[${provider}/${model}] free no-auth provider disabled by settings`);
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
      }
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("SYSTEMONE", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      log.warn("SYSTEMONE", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const result = toCoreResult(
      await handleSystemoneCore({
        body,
        modelInfo: { provider, model },
        credentials: toExecutorCredentials({ ...credentials }),
        log,
        onRequestSuccess: async () => {
          await clearAccountError(credentials.connectionId, credentials, model);
        },
      }),
      "System One request failed",
    );

    if (result.success) return recordApiKeyUsageForResponse(apiKey, result.response, { tokens: estimatedTokens, cost: 0 });

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, null, {
      usedCredential: credentials.accessToken || credentials.apiKey || null
    });
    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}
export const handleSystemone = withRequestCorrelation(handleSystemoneHandler);
