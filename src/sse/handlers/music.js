import { withRequestCorrelation, getRequestId } from "../utils/requestCorrelation.js";
import { createMediaJob, getMediaJob, finishMediaJob } from "@/lib/db/repos/mediaJobsRepo.js";
import { getProviderCredentialsWithQuotaPreflight, resolveClientApiKey, markAccountUnavailable } from "../services/auth.js";
import { getSettings, getProviderConnectionById, getApiKeyProviderConnectionIds } from "@/lib/localDb";
import { getModelInfo } from "../services/model.js";
import { handleMusicGenerationCore } from "open-sse/handlers/musicGenerationCore.js";
import { sanitizeSecrets } from "open-sse/handlers/videoCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { enforceApiKeyModelPolicy, recordApiKeyUsage, recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";
import * as log from "../utils/logger.js";
import { handleComboChat } from "open-sse/services/combo.js";
import { wantsDefaultRoute, resolveMediaRoute, defaultRouteComboOptions } from "../services/mediaRoutes.js";
import { isString } from "../../shared/utils/typeChecks.js";

const endpoint = "/v1/music/generations";
const asyncProviders = new Set(["suno", "udio"]);

function connectionResponse(response, connectionId) {
  const headers = new Headers(response.headers);
  headers.set("x-9router-connection-id", connectionId);
  headers.set("Access-Control-Expose-Headers", "x-9router-connection-id, x-request-id");
  return new Response(response.body, { status: response.status, headers });
}

async function replayMusicJob(job, apiKey) {
  const { response, status, timestamp, ...accounting } = job.terminal;
  if (status === "succeeded") await recordApiKeyUsage(apiKey, {
    ...accounting, timestamp, usageEventId: job.usageEventId, provider: job.provider,
    model: job.model, connectionId: job.connectionId, endpoint: job.endpoint, modality: "music",
    billingEpoch: job.billingEpoch,
  });
  return connectionResponse(new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }), job.connectionId);
}

async function finishMusicResult(job, apiKeyId, apiKey, result, credentials) {
  if (!result.job.terminal) return connectionResponse(result.response, job.connectionId);
  const { state, ...accounting } = result.accounting;
  const completed = await finishMediaJob(job, apiKeyId, {
    ...accounting, status: result.job.terminal,
    response: { body: sanitizeSecrets(await result.response.text(), credentials), status: result.response.status },
  });
  return replayMusicJob(completed, apiKey);
}

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
      handleSingleModel: (b, m) => handleSingleModelMusic(b, m, request, apiKey, apiKeyAuth.apiKeyId, preferredConnectionId, apiKeyAuth.billingEpoch),
      log,
      ...defaultRouteComboOptions("music")
    });
  }
  return handleSingleModelMusic(body, body.model, request, apiKey, apiKeyAuth.apiKeyId, preferredConnectionId, apiKeyAuth.billingEpoch);
}

async function handleSingleModelMusic(body, modelStr, request, apiKey, apiKeyId, preferredConnectionId, billingEpoch) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  const { provider, model } = modelInfo;
  const policyError = await enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey);
  if (policyError) return policyError;
  if (asyncProviders.has(provider) && !apiKeyId) return errorResponse(HTTP_STATUS.FORBIDDEN, "Music jobs require a stored caller API key");
  const usageEventId = `${getRequestId(request)}:music`;

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

    // Synchronous and deferred receipts retain admission, never completion, epoch.
    const usage = (accounting) => {
      const { state, ...receipt } = accounting;
      return { ...receipt, billingEpoch, usageEventId, provider, model, connectionId: credentials.connectionId ?? null, endpoint, modality: "music" };
    };
    const result = await handleMusicGenerationCore({
      provider, model, body, credentials, signal: request.signal,
      onComplete: (accounting) => recordApiKeyUsage(apiKey, usage(accounting)),
    });
    if (result.success) {
      if (result.job) {
        await createMediaJob({ modality: "music", provider, model, connectionId: credentials.connectionId, resourceId: result.job.resourceId, apiKeyId, usageEventId, endpoint, billingEpoch });
        // Creation never bills asynchronous providers, even if its snapshot
        // already looks complete. The owned GET lifecycle confirms completion.
        return connectionResponse(result.response, credentials.connectionId);
      }
      if (!result.deferred && result.accounting?.state === "complete") return recordApiKeyUsageForResponse(apiKey, result.response, usage(result.accounting));
      return result.response;
    }

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

/** GET /v1/music/generations/{request_id}. Poll using the returned connection
 * header and the original caller API key. Submission and unfinished polls cost
 * no usage event; durable terminal evidence replays one idempotent ledger event.
 */
async function handleMusicGetHandler(request, requestId) {
  const settings = await getSettings();
  const { apiKey, auth } = await resolveClientApiKey(request, { required: settings.requireApiKey === true });
  if (!auth.ok) return errorResponse(HTTP_STATUS.UNAUTHORIZED, auth.reason === "missing" ? "Missing API key" : "Invalid API key");
  const connectionId = request.headers.get("x-9router-connection-id") || request.headers.get("x-connection-id");
  if (!auth.apiKeyId || !connectionId) return errorResponse(HTTP_STATUS.FORBIDDEN, "Music polling requires durable ownership and x-9router-connection-id");
  if (!isString(requestId) || !/^[\w-]+(?:,[\w-]+)*$/.test(requestId)) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid music request id");
  const connection = await getProviderConnectionById(connectionId);
  if (!asyncProviders.has(connection?.provider)) return errorResponse(HTTP_STATUS.NOT_FOUND, "Music job not found");
  // Repository preflight rejects stale jobs before upstream; replay uses only the stored epoch.
  const job = await getMediaJob({ modality: "music", provider: connection.provider, connectionId, resourceId: requestId }, auth.apiKeyId);
  if (!job) return errorResponse(HTTP_STATUS.NOT_FOUND, "Music job not found");
  const allowed = await getApiKeyProviderConnectionIds(auth.apiKeyId);
  if (allowed.length && !allowed.includes(connectionId)) return errorResponse(HTTP_STATUS.FORBIDDEN, "Requested connection is not available for this API key");
  const policyError = await enforceApiKeyModelPolicy(request, `${job.provider}/${job.model}`, apiKey, { limits: false });
  if (policyError) return policyError;
  if (job.terminal) return replayMusicJob(job, apiKey);
  const credentials = await getProviderCredentialsWithQuotaPreflight(job.provider, null, job.model, {
    preferredConnectionId: connectionId, strictConnectionId: connectionId, apiKeyId: auth.apiKeyId,
  });
  if (!credentials || credentials.allRateLimited || credentials.providerDisabled || credentials.connectionId !== connectionId) return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, "Music job connection unavailable");
  const result = await handleMusicGenerationCore({ provider: job.provider, model: job.model, requestId: job.resourceId, credentials, signal: request.signal });
  if (!result.success) return result.response;
  if (result.job?.resourceId !== job.resourceId) return errorResponse(HTTP_STATUS.BAD_GATEWAY, "Music provider returned different job identities");
  return finishMusicResult(job, auth.apiKeyId, apiKey, result, credentials);
}
export const handleMusicGet = withRequestCorrelation(handleMusicGetHandler);
export const handleMusicGeneration = withRequestCorrelation(handleMusicGenerationHandler);
