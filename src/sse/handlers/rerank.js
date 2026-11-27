import { credentialDispatchSnapshot } from "@/shared/utils/credentialFingerprint.js";
import { getRequestId, withRequestCorrelation } from "../utils/requestCorrelation.js";
import {
  getNoAuthProviderCredentials,
  clearAccountError,
} from "../services/auth.js";
import { getSettings } from "@/lib/localDb";
import { handleRerankCore } from "open-sse/handlers/rerankCore.js";
import { runWithModelFallback } from "open-sse/services/modelFallback.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { toExecutorCredentials } from "./typeHelpers.js";
import { recordAcceptedJobUsage, recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";
import { checkAndRefreshToken, updateProviderCredentials } from "../services/tokenRefresh.js";
import { resolveTypedMediaModel, runMediaAccounts, runMediaEndpoint } from "./media/pipeline.js";

// combo.js ACCEPTED_JOB_HEADER: an accepted or uncertain submit stops every
// fallback. Kept local so this route does not load the combo engine.
const ACCEPTED_JOB_HEADER = "x-durindoor-accepted-job";

/** Providers whose rerank core runs one bounded native submit (rerankCore.js). */
const NATIVE_RERANK_PROVIDERS = new Set(["deepinfra"]);

/**
 * Handle rerank request — Cohere/Jina/Voyage-style /v1/rerank passthrough.
 * Follows the same auth + fallback pattern as handleChat/handleEmbeddings.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleRerankHandler(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const modelStr = body.model;
  log.request("POST", `${url.pathname} | ${modelStr}`);

  return runMediaEndpoint(request, {
    kind: "rerank",
    pinConnection: true,
    route: (admission, pinOptions) => routeRerank(request, body, modelStr, url, admission, pinOptions),
  });
}

async function routeRerank(request, body, modelStr, url, { settings, apiKey, auth: apiKeyAuth }, pinOptions) {

  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  if (body.query === undefined || body.query === null) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: query");
  if (!Array.isArray(body.documents)) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: documents (array)");

  // Model and account fallbacks retain the original admission epoch.
  const usageContext = { billingEpoch: apiKeyAuth.billingEpoch, usageEventId: `${getRequestId(request)}:${url.pathname}`, endpoint: url.pathname };
  // Once a provider may have billed a submit, no fallback model receives the
  // request: every later hop answers with that same recorded response.
  let accepted = null;
  return runWithModelFallback(
    modelStr,
    settings.modelFallbacks,
    async (m) => {
      if (accepted) return accepted.clone();
      const response = await handleSingleModelRerank(m, body, request, apiKey, apiKeyAuth.apiKeyId, usageContext, pinOptions);
      if (response.headers?.get?.(ACCEPTED_JOB_HEADER)) accepted = response.clone();
      return response;
    },
    log
  );
}

async function handleSingleModelRerank(modelStr, body, request, apiKey, apiKeyId, usageContext, pinOptions) {
  const modelInfo = await resolveTypedMediaModel(request, modelStr, body, apiKey, "rerank", {
    // Reject unsupported routing before model policy consumes an RPM allowance.
    async beforePolicy(provider) {
      if (provider !== "openrouter") return null;
      const policy = (await getSettings()).openrouterRouting;
      if (policy?.zdr || policy?.quantizations?.length || body.provider?.zdr || body.provider?.quantizations) {
        return errorResponse(HTTP_STATUS.BAD_REQUEST, "OpenRouter rerank cannot enforce the configured routing restrictions");
      }
      return null;
    },
  });
  if (modelInfo.error) return modelInfo.error;
  const { provider, model } = modelInfo;

  /** Record the core receipt without consuming the response or guessing document charges. */
  const recordSuccess = (result, credentials) => recordApiKeyUsageForResponse(apiKey, result.response, {
    ...result.accounting,
    ...usageContext,
    provider,
    model,
    connectionId: credentials.connectionId || null,
    modality: "rerank",
    // The stable id of the admitted key travels with the usage.
    apiKeyId,
  });
  /** A submit the provider may have billed without a usable answer (DeepInfra
   * native): recorded once on the sending account, never replayed. */
  const recordAccepted = async (result, credentials) => {
    await recordAcceptedJobUsage(apiKey, {
      ...result.acceptedJob,
      ...usageContext,
      provider,
      model,
      connectionId: credentials.connectionId || null,
      modality: "rerank",
      apiKeyId,
    });
    const response = result.response || errorResponse(result.status, result.error);
    const headers = new Headers(response.headers);
    headers.set(ACCEPTED_JOB_HEADER, "1");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };
  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  const { getExecutor } = await import("open-sse/executors/index.js");
  const executor = getExecutor(provider);
  if (executor?.noAuth) {
    const credentials = await getNoAuthProviderCredentials(provider, model, { ...pinOptions, apiKeyId });
    if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
      if (credentials?.providerDisabled) {
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
      }
      return errorResponse(
        credentials?.allRateLimited ? Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE : HTTP_STATUS.BAD_REQUEST,
        credentials?.lastError || `No credentials for provider: ${provider}`,
      );
    }
    const result = await handleRerankCore({ body, modelInfo: { provider, model }, credentials, log });
    if (result.success) return recordSuccess(result, credentials);
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Rerank failed");
  }

  return runMediaAccounts({
    provider, model, selectionOptions: { ...pinOptions, apiKeyId },
    buildExhaustedResponse(credentials, { lastError, lastStatus, attempted }) {
      if (credentials?.providerDisabled) {
        log.warn("RERANK", `[${provider}/${model}] free no-auth provider disabled by settings`);
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
      }
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("RERANK", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (attempted === 0) {
        log.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    },
    async runAttempt(credentials) {
    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${credentials.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(provider, { ...credentials });
    const dispatch = credentialDispatchSnapshot(refreshedCredentials);
    let result = await handleRerankCore({
      body,
      modelInfo: { provider, model },
      credentials: toExecutorCredentials(refreshedCredentials),
      signal: request.signal,
      log,
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model, dispatch);
      },
    });
    // Native services own their single bounded submit: no refresh, no resend
    // and no credential rewrite on a refusal.
    if (!result.success && !NATIVE_RERANK_PROVIDERS.has(provider) && [HTTP_STATUS.UNAUTHORIZED, HTTP_STATUS.FORBIDDEN].includes(result.status)) {
      const retryCredentials = await checkAndRefreshToken(provider, { ...credentials, accessToken: null });
      if (retryCredentials.accessToken !== credentials.accessToken) {
        await updateProviderCredentials(credentials.connectionId, { accessToken: retryCredentials.accessToken, refreshToken: retryCredentials.refreshToken, providerSpecificData: retryCredentials.providerSpecificData, testStatus: "active" });
        result = await handleRerankCore({ body, modelInfo: { provider, model }, credentials: toExecutorCredentials(retryCredentials), signal: request.signal, log });
      }
    }

    if (result.success) return { response: await recordSuccess(result, credentials) };
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
    },
  });
}
export const handleRerank = withRequestCorrelation(handleRerankHandler);
