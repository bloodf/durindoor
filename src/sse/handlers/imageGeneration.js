import { withRequestCorrelation } from "../utils/requestCorrelation.js";
import {
  getProviderCredentialsWithQuotaPreflight,
  getNoAuthProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  resolveClientApiKey,
} from "../services/auth.js";
import { getSettings, getApiKeyByKey } from "@/lib/localDb";
import { getModelInfo, getComboModels, getComboCanonicalName } from "../services/model.js";
import { isAutoComboId } from "open-sse/services/autoComboResolver.js";
import { handleImageGenerationCore } from "open-sse/handlers/imageGenerationCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { handleComboChat } from "open-sse/services/combo.js";
import * as log from "../utils/logger.js";
import { enforceApiKeyModelPolicy, recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";

// Providers that don't require credentials (noAuth)
const NO_AUTH_PROVIDERS = new Set(["sdwebui", "comfyui"]);

/**
 * Handle image generation request
 * @param {Request} request
 */
async function handleImageGenerationHandler(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const preferredConnectionId = request.headers.get("x-connection-id") || null;
  const wantsStream = (request.headers.get("accept") || "").includes("text/event-stream");
  const binaryOutput = url.searchParams.get("response_format") === "binary";
  const modelStr = body.model;

  const settings = await getSettings();
  const { apiKey, auth: apiKeyAuth } = await resolveClientApiKey(request, {
    required: settings.requireApiKey === true,
  });
  if (!apiKeyAuth.ok) return errorResponse(
    HTTP_STATUS.UNAUTHORIZED,
    apiKeyAuth.reason === "missing" ? "Missing API key" : "Invalid API key",
  );

  // Per-key combo access control
  if (apiKey && modelStr) {
    const keyData = await getApiKeyByKey(apiKey);
    if (keyData && Array.isArray(keyData.allowedCombos) && keyData.allowedCombos.length > 0) {
      const comboName = await getComboCanonicalName(modelStr);
      if (comboName && !keyData.allowedCombos.includes(comboName)) {
        log.warn("AUTH", `API key "${keyData.name}" not allowed to access combo "${comboName}"`);
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Access denied: combo "${comboName}" is not allowed for this API key`);
      }
    }
  }

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (!body.prompt) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");

  // Combo expansion: model may be a combo name → run fallback/round-robin across models
  // #6495 / F-4: filter paid members when the toggle is on. Auth ACL check
  // above calls getComboModels without the flag so combo existence/ACL stay
  // against the real member list.
  const comboModels = await getComboModels(modelStr, settings.hidePaidModels === true);
  if (comboModels) {
    const comboName = (await getComboCanonicalName(modelStr)) || modelStr;
    const comboStrategies = settings.comboStrategies || {};
    const perCombo = comboStrategies[comboName] || {};
    const comboSpecificStrategy = isAutoComboId(modelStr)
      ? (perCombo.strategy ?? perCombo.fallbackStrategy)
      : perCombo.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("IMAGE", `Combo "${comboName}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelImage(b, m, request, apiKey, apiKeyAuth.apiKeyId, { wantsStream, binaryOutput, preferredConnectionId }),
      log,
      comboName,
      comboStrategy,
      comboStickyLimit,
    });
  }
  return handleSingleModelImage(body, modelStr, request, apiKey, apiKeyAuth.apiKeyId, { wantsStream, binaryOutput, preferredConnectionId });
}

async function handleSingleModelImage(body, modelStr, request, apiKey, apiKeyId, { wantsStream, binaryOutput, preferredConnectionId } = {}) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;
  const resolvedPolicyError = await enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey);
  if (resolvedPolicyError) return resolvedPolicyError;
  const estimatedTokens = String(body.prompt || "").length / 4;

  // Explicit no-auth providers still pass through the shared account selector:
  // scoped keys cannot escape to an anonymous/local endpoint.
  if (NO_AUTH_PROVIDERS.has(provider)) {
    const credentials = await getNoAuthProviderCredentials(provider, model, { preferredConnectionId, apiKeyId });
    if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
      if (credentials?.providerDisabled) {
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
      }
      return errorResponse(
        credentials?.allRateLimited ? Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE : HTTP_STATUS.BAD_REQUEST,
        credentials?.lastError || `No credentials for provider: ${provider}`,
      );
    }
    const result = await handleImageGenerationCore({
      body,
      modelInfo: { provider, model },
      credentials: credentials.connectionId ? credentials : null,
      binaryOutput,
    });
    if (result.success) return recordApiKeyUsageForResponse(apiKey, result.response, { tokens: estimatedTokens, cost: 0 });
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Image generation failed");
  }

  // Credentialed providers — fallback loop
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentialsWithQuotaPreflight(provider, excludeConnectionIds, model, { preferredConnectionId, apiKeyId });

    // All accounts unavailable or provider disabled
    if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
      if (credentials?.providerDisabled) {
        log.warn("IMAGE_GENERATION", `[${provider}/${model}] free no-auth provider disabled by settings`);
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
      }
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    const result = await handleImageGenerationCore({
      body,
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      streamToClient: wantsStream,
      binaryOutput,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      }
    });

    if (result.success) return recordApiKeyUsageForResponse(apiKey, result.response, { tokens: estimatedTokens, cost: 0 });

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model);

    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}
export const handleImageGeneration = withRequestCorrelation(handleImageGenerationHandler);
