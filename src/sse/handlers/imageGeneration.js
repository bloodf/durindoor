import { parseAutoModel, getAutoModelCandidates } from "../services/autoModel.js";
import { credentialDispatchSnapshot } from "@/shared/utils/credentialFingerprint.js";
import { captureRequestBillingEpoch, getRequestId, withRequestCorrelation } from "../utils/requestCorrelation.js";
import {
  getNoAuthProviderCredentials,
  clearAccountError,
} from "../services/auth.js";
import { getApiKeyByKey, getComboForModel } from "@/lib/localDb";
import { getComboModels, getComboCanonicalName } from "../services/model.js";
import { isAutoComboId } from "open-sse/services/autoComboResolver.js";
import { handleImageGenerationCore } from "open-sse/handlers/imageGenerationCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { leasedAntigravityRefresher } from "./media/antigravityRefresh.js";
import { ACCEPTED_JOB_HEADER, handleComboChat, comboPolicyRejection } from "open-sse/services/combo.js";
import { formatRetryAfter } from "open-sse/services/accountFallback.js";
import * as log from "../utils/logger.js";
import { recordApiKeyUsage, recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";
import { getComboRoutingPolicy } from "open-sse/services/comboRoutingPolicy.js";
import { wantsDefaultRoute, resolveMediaRoute, defaultRouteComboOptions } from "../services/mediaRoutes.js";
import { checkModelLifecycle } from "open-sse/handlers/chatCore/modelLifecyclePolicy.js";
import { resolveImageModel, runMediaAccounts, runMediaEndpoint } from "./media/pipeline.js";

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
  const wantsStream = (request.headers.get("accept") || "").includes("text/event-stream");
  const binaryOutput = url.searchParams.get("response_format") === "binary";
  const modelStr = body.model;

  return runMediaEndpoint(request, {
    kind: "imageGeneration",
    pinConnection: true,
    route: (admission, pinOptions) => routeImageGeneration(request, body, {
      modelStr, wantsStream, binaryOutput, pinOptions,
    }, admission),
  });
}

async function routeImageGeneration(request, body, { modelStr, wantsStream, binaryOutput, pinOptions }, { settings, apiKey, auth: apiKeyAuth }) {
  // Capture once for combo retries and delayed stream completion, preserving null.
  const { billingEpoch } = apiKeyAuth;
  const authenticatedKeyRecord = apiKey ? await getApiKeyByKey(apiKey) : null;
  if (authenticatedKeyRecord && authenticatedKeyRecord.policy?.allowAutoCombos === false && (isAutoComboId(modelStr) || (parseAutoModel(modelStr, "image") && !(await getComboForModel(modelStr))))) {
    return errorResponse(HTTP_STATUS.FORBIDDEN, "Access denied: auto combos are not allowed for this API key");
  }

  // Per-key combo access control
  if (apiKey && modelStr) {
    const keyData = await getApiKeyByKey(apiKey);
    if (keyData && Array.isArray(keyData.allowedCombos) && keyData.allowedCombos.length > 0) {
      const comboName = await getComboCanonicalName(modelStr) || parseAutoModel(modelStr, "image")?.name;
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
      apiKeyId: apiKeyAuth.apiKeyId,
      body,
      models: route.models,
      handleSingleModel: (b, m, _signal, attemptOptions) => handleSingleModelImage(b, m, request, apiKey, apiKeyAuth.apiKeyId, { billingEpoch, wantsStream, binaryOutput, pinOptions, reportComboPolicyRejections: attemptOptions?.reportComboPolicyRejections }),
      log,
      signal: request.signal,
      ...defaultRouteComboOptions("image")
    });
  }

  // Combo expansion: model may be a combo name → run fallback/round-robin across models
  // #6495 / F-4: filter paid members when the toggle is on. Auth ACL check
  // above calls getComboModels without the flag so combo existence/ACL stay
  // against the real member list.
  const savedComboModels = await getComboModels(modelStr, settings.hidePaidModels === true, settings);
  const selector = savedComboModels ? null : await getAutoModelCandidates(modelStr, "image", request, apiKeyAuth.apiKeyId);
  const comboModels = savedComboModels || selector?.models;
  if (comboModels) {
    const comboName = (await getComboCanonicalName(modelStr)) || modelStr;
    const combo = isAutoComboId(modelStr) ? null : await getComboForModel(comboName);
    const comboStrategies = settings.comboStrategies || {};
    const perCombo = comboStrategies[comboName] || {};
    const comboSpecificStrategy = isAutoComboId(modelStr)
      ? (perCombo.strategy ?? perCombo.fallbackStrategy)
      : perCombo.fallbackStrategy;
    const comboStrategy = selector ? "fallback" : comboSpecificStrategy || settings.comboStrategy || "fallback";
    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    const comboRouting = await getComboRoutingPolicy(comboName);
    log.info("IMAGE", `Combo "${comboName}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      apiKeyId: apiKeyAuth.apiKeyId,
      body,
      models: comboModels,
      handleSingleModel: (b, m, _signal, attemptOptions) => handleSingleModelImage(b, m, request, apiKey, apiKeyAuth.apiKeyId, { billingEpoch, wantsStream, binaryOutput, pinOptions, comboRouting, reportComboPolicyRejections: attemptOptions?.reportComboPolicyRejections }),
      log,
      signal: request.signal,
      comboName,
      comboStrategy,
      comboStickyLimit,
      comboMembers: combo?.members || []
    });
  }
  return handleSingleModelImage(body, modelStr, request, apiKey, apiKeyAuth.apiKeyId, { billingEpoch, wantsStream, binaryOutput, pinOptions });
}

async function handleSingleModelImage(body, modelStr, request, apiKey, apiKeyId, { billingEpoch, wantsStream, binaryOutput, pinOptions, comboRouting = null, reportComboPolicyRejections = false } = {}) {
  const { provider, model, error } = await resolveImageModel(request, modelStr, body, apiKey, {
    onPolicyError: (policyError) => reportComboPolicyRejections && policyError.status === HTTP_STATUS.FORBIDDEN ? comboPolicyRejection() : policyError,
    // Reject retired models before selecting an account or affecting its health.
    checkLifecycle: (provider, model) => checkModelLifecycle({ provider, canonicalModel: model, log })?.response,
  });
  if (error) return error;

  const selectionOptions = {
    ...pinOptions,
    apiKeyId,
    allowedConnectionIds: comboRouting?.allowedConnectionIds || null,
    restrictionApplied: comboRouting?.restrictionApplied === true,
  };
  // Explicit no-auth providers still pass through the shared account selector:
  // scoped keys cannot escape to an anonymous/local endpoint.
  if (NO_AUTH_PROVIDERS.has(provider)) {
    const credentials = await getNoAuthProviderCredentials(provider, model, selectionOptions);
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

  // Keep bounded retry hints from accounts actually attempted on this route.
  const attemptedRateLimits = new Map();

  return runMediaAccounts({
    provider,
    model,
    selectionOptions,
    buildExhaustedResponse(credentials, { lastError, lastStatus, attempted }) {
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
      if (attempted === 0) {
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      const hint = aggregateRateLimitHint(attemptedRateLimits, lastStatus);
      if (hint?.retryAt) {
        return unavailableResponse(429, lastError || "All accounts unavailable", hint.retryAt, formatRetryAfter(hint.retryAt));
      }
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    },
    async runAttempt(credentials) {
      const refreshedCredentials = await checkAndRefreshToken(provider, credentials);
      const dispatch = credentialDispatchSnapshot(refreshedCredentials);
      // Cores and executors mutate the dispatched credentials before the callback runs.
      const presentedRefreshToken = refreshedCredentials.refreshToken;
      // Without a sent refresh token there is nothing to guard against.
      const refreshGuard = presentedRefreshToken ? [{ presentedRefreshToken }] : [];

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
          }, ...refreshGuard);
        },
        refreshCredentials: leasedAntigravityRefresher(refreshedCredentials),
        onRequestSuccess: async () => {
          await clearAccountError(credentials.connectionId, credentials, model, dispatch);
        }
      });

      if (result.success) return { response: await recordImageUsage(apiKey, result, request, provider, model, credentials.connectionId, billingEpoch, apiKeyId) };

      // Client abort: no account cooldown and no fallthrough to other accounts.
      if (request.signal?.aborted) {
        if (!result.acceptedJob) return { response: result.response };
        await recordAcceptedImageJob(apiKey, result.acceptedJob, request, provider, model, credentials.connectionId, billingEpoch, apiKeyId);
        return { response: markAcceptedJob(result.response) };
      }
      return {
        result,
        dispatch,
        resetAt: result.rateLimitEvidence?.resetAtMs ?? null,
        failureContext: result.rateLimitEvidence
          ? { rateLimitEvidence: result.rateLimitEvidence, exhaustionScope: "model" }
          : undefined,
      };
    },
    async onAccountFailure(result, credentials) {
      // The provider may still bill an accepted job, so stop after updating account health.
      if (!result.acceptedJob) return null;
      await recordAcceptedImageJob(apiKey, result.acceptedJob, request, provider, model, credentials.connectionId, billingEpoch, apiKeyId);
      return markAcceptedJob(result.response);
    },
    onFallback(result, credentials, { retryAt, retryAtKnown }) {
      attemptedRateLimits.set(credentials.connectionId, {
        status: result.status,
        retryAt: retryAt || null,
        // Only a proven, bounded exhaustion hint is carried.
        retryAtKnown: Boolean(result.rateLimitEvidence) && retryAtKnown !== false && Boolean(retryAt),
      });
    },
  });
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
