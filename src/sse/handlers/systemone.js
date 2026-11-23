import { admit } from "../services/admission.js";
import { credentialDispatchSnapshot } from "@/shared/utils/credentialFingerprint.js";
import { randomUUID } from "node:crypto";
import { withRequestCorrelation } from "../utils/requestCorrelation.js";
import {
  getProviderCredentialsWithQuotaPreflight,
  getNoAuthProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
} from "../services/auth.js";
import { getModelInfo } from "../services/model.js";
import { handleSystemoneCore } from "open-sse/handlers/systemoneCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { toExecutorCredentials, toCoreResult } from "./typeHelpers.js";
import { enforceApiKeyModelPolicy } from "../services/apiKeyPolicy.js";
import { nativeUsageAdmission, observeNativeResponse } from "../services/nativeUsage.js";
import { isObject } from "../../shared/utils/typeChecks.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { resolveCredentialProxyOptions } from "open-sse/services/oauthCredentialManager.js";

/**
 * Handle System One (Jev) decision requests — native /v1/systemone passthrough.
 * Follows the same auth + fallback pattern as handleRerank/handleEmbeddings.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */

function proxyOptionsFromCredentials(credentials) {
  return resolveCredentialProxyOptions(credentials);
}

function recordSystemoneUsage({ apiKey, billingEpoch, provider, model, credentials, response, usageEventId }) {
  // Read the original envelope: core summary omits cache and reasoning components.
  return observeNativeResponse(response, {
    apiKey,
    billingEpoch,
    provider,
    model,
    connectionId: credentials?.connectionId || null,
    endpoint: "/v1/systemone",
    usageEventId,
    modality: "systemone", tokens: {}, nativeUnits: {},
    cost: null, costStatus: "unknown", costSource: "provider-cost-unavailable",
  });
}

function isNoAuthSystemoneProvider(provider) {
  return REGISTRY.some((entry) => entry.id === provider && entry.noAuth === true);
}

async function handleSystemoneHandler(request) {
  if (request.signal.aborted) return errorResponse(499, "Request aborted");
  let body;
  try {
    body = await request.json();
  } catch {
    if (request.signal.aborted) return errorResponse(499, "Request aborted");
    log.warn("SYSTEMONE", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const modelStr = body.model;
  log.request("POST", `${url.pathname} | ${modelStr}`);

  const { settings, apiKey, auth: apiKeyAuth, error: admissionError } = await admit(request, { kind: "systemone" });
  if (apiKey) {
    log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }
  if (admissionError) {
    log.warn("AUTH", apiKeyAuth.reason === "missing" ? "Missing API key (requireApiKey=true)" : "Invalid API key");
    return admissionError;
  }
  // Retain the admission generation through retries and deferred response usage.
  const billingEpoch = apiKeyAuth.billingEpoch;

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

  const usageAdmissionError = await nativeUsageAdmission(apiKey);
  if (usageAdmissionError) return usageAdmissionError;

  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    log.warn("SYSTEMONE", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;
  const resolvedPolicyError = await enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey);
  if (resolvedPolicyError) return resolvedPolicyError;

  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  const pin = request.headers.get("x-connection-id") || null;
  const usageEventId = randomUUID();
  const pinOptions = pin ? { preferredConnectionId: pin, strictConnectionId: pin } : {};
  const noAuth = isNoAuthSystemoneProvider(provider);
  if (noAuth) {
    const credentials = await getNoAuthProviderCredentials(provider, model, { ...pinOptions, apiKeyId: apiKeyAuth.apiKeyId });
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
      await handleSystemoneCore({
        routingPolicy: (await getSettings()).openrouterRouting,
        body,
        modelInfo: { provider, model },
        credentials,
        log,
        signal: request.signal,
        proxyOptions: proxyOptionsFromCredentials(credentials),
      }),
      "System One request failed",
    );
    if (result.success) {
      return recordSystemoneUsage({ apiKey, billingEpoch, provider, model, credentials, response: result.response, usageEventId });
    }
    if (result.status === 499) return result.response;
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "System One request failed");
  }

  // Credential + fallback loop (mirrors handleRerank). The dashboard example
  // sends x-connection-id for the selected connection; a pinned request uses
  // only that connection (strict), so it never reaches another host or key.
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

    const dispatch = credentialDispatchSnapshot(credentials);
    const result = toCoreResult(
      await handleSystemoneCore({
        routingPolicy: (await getSettings()).openrouterRouting,
        body,
        modelInfo: { provider, model },
        credentials: toExecutorCredentials({ ...credentials }),
        log,
        signal: request.signal,
        proxyOptions: proxyOptionsFromCredentials(credentials),
        onRequestSuccess: async () => {
          await clearAccountError(credentials.connectionId, credentials, model, dispatch);
        },
      }),
      "System One request failed",
    );

    if (result.success) {
      return recordSystemoneUsage({ apiKey, billingEpoch, provider, model, credentials, response: result.response, usageEventId });
    }

    if (result.status === 499) return result.response;

    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, null, {
      usedCredential: credentials.accessToken || credentials.apiKey || null,
      ...dispatch
    });
    if (shouldFallback) {
      log.warn("AUTH", `Account ${credentials.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "System One request failed");
  }
}
export const handleSystemone = withRequestCorrelation(handleSystemoneHandler);
