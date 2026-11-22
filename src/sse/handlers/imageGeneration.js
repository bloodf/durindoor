import { captureRequestBillingEpoch, getRequestId, withRequestCorrelation } from "../utils/requestCorrelation.js";
import {
  getProviderCredentialsWithQuotaPreflight,
  getNoAuthProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  resolveClientApiKey,
} from "../services/auth.js";
import { getSettings, getApiKeyByKey, getComboForModel } from "@/lib/localDb";
import { getModelInfo, getComboModels, getComboCanonicalName } from "../services/model.js";
import { isAutoComboId } from "open-sse/services/autoComboResolver.js";
import { handleImageGenerationCore } from "open-sse/handlers/imageGenerationCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { ACCEPTED_JOB_HEADER, handleComboChat } from "open-sse/services/combo.js";
import { formatRetryAfter } from "open-sse/services/accountFallback.js";
import * as log from "../utils/logger.js";
import { enforceApiKeyModelPolicy, recordApiKeyUsage, recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";
import { annotateClientAdmissionFailure } from "open-sse/services/operationalMetrics.js";
import { getComboRoutingPolicy } from "open-sse/services/comboRoutingPolicy.js";
import { wantsDefaultRoute, resolveMediaRoute, defaultRouteComboOptions } from "../services/mediaRoutes.js";
import { checkModelLifecycle } from "open-sse/handlers/chatCore/modelLifecyclePolicy.js";
import { imageModelKindError } from "./imageModelKind.js";

// Providers that don't require credentials (noAuth)
const NO_AUTH_PROVIDERS = new Set(["sdwebui", "comfyui"]);

/**
 * Handle image generation request
 * Successful operations use request correlation as their ledger identity.
 * Core accounting preserves receipts and provenance without reading response bodies.
 * Codex awaits final accounting persistence before its done event. Headers are not success.
 * @param {Request} request
 */
async function handleImageGenerationHandler(request) {
  await captureRequestBillingEpoch(request);
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
  // Capture once for combo retries and delayed stream completion, preserving null.
  const { billingEpoch } = apiKeyAuth;
  if (!apiKeyAuth.ok) return annotateClientAdmissionFailure(errorResponse(
    HTTP_STATUS.UNAUTHORIZED,
    apiKeyAuth.reason === "missing" ? "Missing API key" : "Invalid API key",
  ), apiKeyAuth.reason === "missing" ? "auth_missing" : "auth_invalid");

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

  if (!body.prompt) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");
  // Binary output carries one image payload; reject n > 1 before combo/account/upstream dispatch.
  if (binaryOutput && Number(body.n) > 1) {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Binary image output (response_format=binary) supports at most n=1");
  }

  if (wantsDefaultRoute(modelStr)) {
    const route = await resolveMediaRoute("image", { settings, apiKeyId: apiKeyAuth.apiKeyId });
    if (route.error) return route.error;
    return handleComboChat({
      body,
      models: route.models,
      handleSingleModel: (b, m) => handleSingleModelImage(b, m, request, apiKey, apiKeyAuth.apiKeyId, { billingEpoch, wantsStream, binaryOutput, preferredConnectionId }),
      log,
      signal: request.signal,
      ...defaultRouteComboOptions("image")
    });
  }

  // Combo expansion: model may be a combo name → run fallback/round-robin across models
  // #6495 / F-4: filter paid members when the toggle is on. Auth ACL check
  // above calls getComboModels without the flag so combo existence/ACL stay
  // against the real member list.
  const comboModels = await getComboModels(modelStr, settings.hidePaidModels === true, settings);
  if (comboModels) {
    const comboName = (await getComboCanonicalName(modelStr)) || modelStr;
    const combo = isAutoComboId(modelStr) ? null : await getComboForModel(comboName);
    const comboStrategies = settings.comboStrategies || {};
    const perCombo = comboStrategies[comboName] || {};
    const comboSpecificStrategy = isAutoComboId(modelStr)
      ? (perCombo.strategy ?? perCombo.fallbackStrategy)
      : perCombo.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    const comboRouting = await getComboRoutingPolicy(comboName);
    log.info("IMAGE", `Combo "${comboName}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelImage(b, m, request, apiKey, apiKeyAuth.apiKeyId, { billingEpoch, wantsStream, binaryOutput, preferredConnectionId, comboRouting }),
      log,
      signal: request.signal,
      comboName,
      comboStrategy,
      comboStickyLimit,
      comboMembers: combo?.members || []
    });
  }
  return handleSingleModelImage(body, modelStr, request, apiKey, apiKeyAuth.apiKeyId, { billingEpoch, wantsStream, binaryOutput, preferredConnectionId });
}

async function handleSingleModelImage(body, modelStr, request, apiKey, apiKeyId, { billingEpoch, wantsStream, binaryOutput, preferredConnectionId, comboRouting = null } = {}) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;
  const resolvedPolicyError = await enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey);
  if (resolvedPolicyError) return resolvedPolicyError;
  // Shut-down image ids answer 410 with their replacement before any account
  // is selected, so a retired model never marks a healthy connection unavailable.
  const lifecycleError = checkModelLifecycle({ provider, canonicalModel: model, log });
  if (lifecycleError) return lifecycleError.response;
  const kindError = await imageModelKindError(provider, model, await getSettings());
  if (kindError) return kindError;
  const pinOptions = preferredConnectionId ? { preferredConnectionId, strictConnectionId: preferredConnectionId } : {};


  // Explicit no-auth providers still pass through the shared account selector:
  // scoped keys cannot escape to an anonymous/local endpoint.
  if (NO_AUTH_PROVIDERS.has(provider)) {
    const credentials = await getNoAuthProviderCredentials(provider, model, {
      ...pinOptions,
      apiKeyId,
      allowedConnectionIds: comboRouting?.allowedConnectionIds || null,
      restrictionApplied: comboRouting?.restrictionApplied === true
    });
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
      signal: request.signal,
    });
    if (result.success) return recordImageUsage(apiKey, result, request, provider, model, credentials.connectionId ?? null, billingEpoch, apiKeyId);
    return errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "Image generation failed");
  }

  // Credentialed providers — fallback loop
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  // Bounded retry hints from attempted accounts, keyed by connection, so the
  // final reconstruction can keep them once failover has nothing left to try.
  const attemptedRateLimits = new Map();

  while (true) {
    const credentials = await getProviderCredentialsWithQuotaPreflight(provider, excludeConnectionIds, model, {
      ...pinOptions,
      apiKeyId,
      allowedConnectionIds: comboRouting?.allowedConnectionIds || null,
      restrictionApplied: comboRouting?.restrictionApplied === true
    });

    // All accounts unavailable or provider disabled
    if (!credentials || credentials.allRateLimited || credentials.providerDisabled) {
      if (credentials?.providerDisabled) {
        log.warn("IMAGE_GENERATION", `[${provider}/${model}] free no-auth provider disabled by settings`);
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
      }
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        // The selector summary and the accounts this request already attempted
        // describe the same requested image route, so the earliest valid
        // deadline of the two is the honest retry time. A bounded hint proven by
        // an attempted account is never dropped by the selector's own summary.
        const hint = combineRetryHint(credentials, aggregateRateLimitHint(attemptedRateLimits, lastStatus));
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, hint.retryAt, hint.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      const attempted = aggregateRateLimitHint(attemptedRateLimits, lastStatus);
      if (attempted?.retryAt) {
        return unavailableResponse(429, lastError || "All accounts unavailable", attempted.retryAt, formatRetryAfter(attempted.retryAt));
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
      signal: request.signal,
      onStreamComplete: async (outcome, response) => {
        if (outcome.status === "success") {
          await recordImageUsage(apiKey, { response, accounting: outcome.accounting }, request, provider, model, credentials.connectionId, billingEpoch, apiKeyId);
        }
      },
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

    if (result.success) return recordImageUsage(apiKey, result, request, provider, model, credentials.connectionId, billingEpoch, apiKeyId);

    // Client abort: no account cooldown and no fallthrough to other accounts.
    if (request.signal?.aborted) {
      if (!result.acceptedJob) return result.response;
      await recordAcceptedImageJob(apiKey, result.acceptedJob, request, provider, model, credentials.connectionId, billingEpoch, apiKeyId);
      return markAcceptedJob(result.response);
    }

    const accountFailureContext = {
      // The credential this attempt actually presented, so a durable-key
      // provider can mark exactly the generation that was rejected.
      usedCredential: credentials.accessToken || credentials.apiKey || null
    };
    if (result.rateLimitEvidence) {
      accountFailureContext.rateLimitEvidence = result.rateLimitEvidence;
      // Image capacity is its own quota: exhaustion stays on the failed model
      // instead of widening to the whole account that chat paths still use.
      accountFailureContext.exhaustionScope = "model";
    }
    const { shouldFallback, retryAt, retryAtKnown } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, result.rateLimitEvidence?.resetAtMs ?? null, accountFailureContext);

    // The provider may still run and bill the accepted job, so another account would
    // be a second billable job. The account health update above still applies.
    if (result.acceptedJob) {
      await recordAcceptedImageJob(apiKey, result.acceptedJob, request, provider, model, credentials.connectionId, billingEpoch, apiKeyId);
      return markAcceptedJob(result.response);
    }

    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      attemptedRateLimits.set(credentials.connectionId, {
        status: result.status,
        retryAt: retryAt || null,
        // Only a proven, bounded exhaustion hint is carried; an ordinary 429
        // keeps its existing final response.
        retryAtKnown: Boolean(result.rateLimitEvidence) && retryAtKnown !== false && Boolean(retryAt)
      });
      continue;
    }

    return result.response;
  }
}

/**
 * A 429 hint for the final response, only when every attempted account ended in
 * a 429 with a known bounded deadline; the earliest one is the honest retry time.
 * Otherwise the ordinary final response is kept and no delay is invented.
 */
function aggregateRateLimitHint(attempted, lastStatus) {
  const entries = [...attempted.values()];
  if (Number(lastStatus) !== 429) return null;
  if (entries.length === 0 || entries.some((entry) => Number(entry.status) !== 429)) return null;
  const complete = entries.every((entry) => entry.retryAtKnown);
  const retryAt = complete
    ? entries.map((entry) => entry.retryAt).sort((left, right) => Date.parse(left) - Date.parse(right))[0]
    : null;
  return { retryAt };
}

/**
 * The selector summary describes the accounts that remain for the requested
 * route. Only a rate-limit summary describes a retry condition for that route:
 * a disabled model, a local quota floor or an authentication failure describes
 * a different condition, so their summary never contributes a retry deadline.
 */
function routeRateLimited(summary) {
  return Number(summary?.lastErrorCode) === 429;
}

/**
 * A deadline in ISO-8601 form. Retry deadlines reach this handler as
 * ISO-8601 strings: the selector summary and the account evidence both
 * publish that shape. A missing or unparseable deadline never wins.
 */
function parseRetryDeadline(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** The earliest of the valid deadlines; a missing one never wins. */
function earliestRetryDeadline(candidates) {
  const deadlines = candidates
    .map((value) => parseRetryDeadline(value))
    .filter(Boolean)
    .map((value) => Date.parse(value));
  if (deadlines.length === 0) return null;
  return new Date(Math.min(...deadlines)).toISOString();
}

/**
 * The final retry hint: the selector summary and the attempted-account
 * evidence describe the same requested image route, so the earliest valid
 * deadline of the two wins. A summary that is not a rate limit for the route
 * keeps the response it had before, and the selector's own wording is kept
 * when its deadline wins.
 */
function combineRetryHint(summary, attempted) {
  if (!routeRateLimited(summary)) return { retryAt: null, retryAfterHuman: "" };
  const selectorDeadline = parseRetryDeadline(summary.retryAfter);
  const retryAt = earliestRetryDeadline([selectorDeadline, attempted?.retryAt || null]);
  if (!retryAt) return { retryAt: null, retryAfterHuman: "" };
  const retryAfterHuman = selectorDeadline === retryAt && summary.retryAfterHuman ?
    summary.retryAfterHuman :
    formatRetryAfter(retryAt);
  return { retryAt, retryAfterHuman };
}

async function recordImageUsage(apiKey, result, request, provider, model, connectionId, billingEpoch, apiKeyId = null) {
  // Streaming commits belong exclusively to the awaited parser callback.
  if (result.completion || result.accounting?.state !== "complete") return result.response;
  const { modality, tokens, nativeUnits, cost, costStatus, costSource, meta } = result.accounting;
  return recordApiKeyUsageForResponse(apiKey, result.response, {
    billingEpoch,
    usageEventId: JSON.stringify([getRequestId(request), "image-generation", provider, model, connectionId]), provider, model, connectionId,
    endpoint: "/v1/images/generations", modality, tokens, nativeUnits, cost, costStatus, costSource, meta,
    // The stable id of the admitted key travels with the usage.
    apiKeyId,
  });
}

/** Tell a combo not to try the next member: the accepted job may still bill. */
function markAcceptedJob(response) {
  const headers = new Headers(response.headers);
  headers.set(ACCEPTED_JOB_HEADER, "1");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** The request already ended without a result, so a ledger failure is logged and never replaces that outcome. */
async function recordAcceptedImageJob(apiKey, accounting, request, provider, model, connectionId, billingEpoch, apiKeyId = null) {
  const { modality, tokens, nativeUnits, cost, costStatus, costSource, meta } = accounting;
  try {
    await recordApiKeyUsage(apiKey, {
      billingEpoch, status: "accepted",
      usageEventId: JSON.stringify([getRequestId(request), "image-generation", provider, model, connectionId]), provider, model, connectionId,
      endpoint: "/v1/images/generations", modality, tokens, nativeUnits, cost, costStatus, costSource, meta,
      // The stable id of the admitted key travels with the usage.
      apiKeyId,
    });
  } catch (error) {
    log.error("IMAGE_GENERATION", `[${provider}/${model}] accepted job not recorded: ${error.message}`);
  }
}

export const handleImageGeneration = withRequestCorrelation(handleImageGenerationHandler);
