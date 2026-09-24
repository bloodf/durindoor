import { withRequestCorrelation } from "../utils/requestCorrelation.js";
import { getProviderCredentialsWithQuotaPreflight, resolveClientApiKey, markAccountUnavailable } from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleMusicGenerationCore } from "open-sse/handlers/musicGenerationCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { enforceApiKeyModelPolicy, recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";
import * as log from "../utils/logger.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { wantsDefaultRoute, resolveMediaRoute, defaultRouteComboOptions } from "../services/mediaRoutes.js";

async function handleMusicGenerationHandler(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const settings = await getSettings();
  const { apiKey, auth: apiKeyAuth } = await resolveClientApiKey(request, {
    required: settings.requireApiKey === true,
  });
  if (!apiKeyAuth.ok) return errorResponse(
    HTTP_STATUS.UNAUTHORIZED,
    apiKeyAuth.reason === "missing" ? "Missing API key" : "Invalid API key",
  );

  const preferredConnectionId = request.headers.get("x-connection-id") || null;
  if (wantsDefaultRoute(body.model)) {
    const route = await resolveMediaRoute("music", { settings, apiKeyId: apiKeyAuth.apiKeyId });
    if (route.error) return route.error;
    return handleComboChat({
      body,
      models: route.models,
      handleSingleModel: (b, m) => handleSingleModelMusic(b, m, request, apiKey, apiKeyAuth.apiKeyId, preferredConnectionId),
      log,
      ...defaultRouteComboOptions("music")
    });
  }
  return handleSingleModelMusic(body, body.model, request, apiKey, apiKeyAuth.apiKeyId, preferredConnectionId);
}

async function handleSingleModelMusic(body, modelStr, request, apiKey, apiKeyId, preferredConnectionId) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  const { provider, model } = modelInfo;
  const policyError = await enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey);
  if (policyError) return policyError;
  const estimatedTokens = String(body.prompt || "").length / 4;

  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentialsWithQuotaPreflight(provider, excludeConnectionIds, model, { preferredConnectionId, apiKeyId });

    if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
      if (credentials?.providerDisabled) {
        log.warn("MUSIC", `[${provider}/${model}] free no-auth provider disabled by settings`);
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
      }
      if (credentials?.allRateLimited) {
        const msg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model}] ${msg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    const result = await handleMusicGenerationCore({ provider, model, body, credentials });
    if (result.success) return recordApiKeyUsageForResponse(apiKey, result.response, { tokens: estimatedTokens, cost: 0 });

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, null, { usedCredential: credentials.accessToken || credentials.apiKey || null });
    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }
    return result.response || errorResponse(result.status, result.error);
  }
}
export const handleMusicGeneration = withRequestCorrelation(handleMusicGenerationHandler);
