import { withRequestCorrelation } from "../utils/requestCorrelation.js";
import { getProviderCredentials, resolveClientApiKey } from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { deriveCountTokensUrl, handleCountTokensCore, estimateTokens } from "open-sse/handlers/countTokensCore.js";
import { PROVIDERS } from "open-sse/config/providers.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { enforceApiKeyModelPolicy } from "../services/apiKeyPolicy.js";
import { annotateClientAdmissionFailure } from "open-sse/services/operationalMetrics.js";

/**
 * Handle /v1/messages/count_tokens. Calls the provider's native count_tokens
 * endpoint when Claude-compatible; otherwise returns the heuristic estimate.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleCountTokensHandler(request) {
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
  if (!apiKeyAuth.ok) return annotateClientAdmissionFailure(errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key"),
    apiKeyAuth.reason === "missing" ? "auth_missing" : "auth_invalid");

  const modelStr = body.model;
  // No model (or unresolvable) → estimate directly from the body.
  if (!modelStr) {
    return Response.json({ input_tokens: estimateTokens(body), approximate: true });
  }

  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo?.provider) {
    return Response.json({ input_tokens: estimateTokens(body), approximate: true });
  }

  const { provider, model } = modelInfo;
  // count_tokens is best-effort: a single credential attempt is enough (the core
  // falls back to the estimate on any failure / no native endpoint).
  const credentials = (await getProviderCredentials(provider, new Set(), model, { apiKeyId: apiKeyAuth.apiKeyId })) || {};
  if (credentials.providerDisabled) {
    return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
  }

  const usesNativeCount = provider === "antigravity" || provider === "agy" ||
    Boolean(deriveCountTokensUrl(credentials.runtimeTransport || PROVIDERS[provider]));
  const policyError = await enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey, { limits: usesNativeCount });
  if (policyError) return policyError;

  const result = await handleCountTokensCore({ body, modelInfo: { provider, model }, credentials, log });
  if (!result.success) {
    if (result.status === HTTP_STATUS.RATE_LIMITED) {
      return Response.json({ input_tokens: estimateTokens(body), approximate: true });
    }
    return errorResponse(result.status, result.error);
  }
  return result.response;
}
export const handleCountTokens = withRequestCorrelation(handleCountTokensHandler);
