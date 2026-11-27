import { credentialDispatchSnapshot } from "@/shared/utils/credentialFingerprint.js";
import { modelKindError } from "./modelKind.js";
import { captureRequestBillingEpoch, getRequestId, withRequestCorrelation } from "../utils/requestCorrelation.js";
import {
  getNoAuthProviderCredentials,
} from "../services/auth.js";
import { getSettings, getApiKeyByKey, getComboForModel } from "@/lib/localDb";
import { getModelInfo, getComboModels, getComboCanonicalName } from "../services/model.js";
import { isAutoComboId } from "open-sse/services/autoComboResolver.js";
import { handleTtsCore } from "open-sse/handlers/ttsCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { handleComboChat, comboPolicyRejection } from "open-sse/services/combo.js";
import * as log from "../utils/logger.js";
import { enforceApiKeyModelPolicy, recordAcceptedJobUsage, recordApiKeyUsageForResponse } from "../services/apiKeyPolicy.js";
import { checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getComboRoutingPolicy } from "open-sse/services/comboRoutingPolicy.js";
import { wantsDefaultRoute, resolveMediaRoute, defaultRouteComboOptions } from "../services/mediaRoutes.js";
import { runMediaAccounts, runMediaEndpoint } from "./media/pipeline.js";

// Derived from providers.js: any TTS provider not noAuth requires stored credentials
const CREDENTIALED_PROVIDERS = new Set(
  Object.entries(AI_PROVIDERS)
    .filter(([, p]) => p.serviceKinds?.includes("tts") && !p.noAuth && p.ttsConfig?.authType !== "none")
    .map(([id]) => id)
);

// Submit-and-poll speech providers: a stored sign-in is refreshed before each job,
// and the client's named response_format reaches the adapter (never an upstream body).
const REFRESHED_BEFORE_DISPATCH = new Set(["renderhour"]);
// Adapters that refuse a response_format they cannot produce: they need the
// format the client named, not the route's mp3 default. Vertex mints its own
// Google token per request, so it is not in the refresh set above.
const NAMED_FORMAT_PROVIDERS = new Set(["renderhour", "vertex"]);

async function handleTtsHandler(request) {
  await captureRequestBillingEpoch(request);
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const url = new URL(request.url);
  const modelStr = body.model;
  const responseFormat = url.searchParams.get("response_format") || "mp3";
  const language = body.language || "";
  log.request("POST", `${url.pathname} | ${modelStr} | format=${responseFormat}${language ? ` | lang=${language}` : ""}`);

  return runMediaEndpoint(request, {
    kind: "tts",
    pinConnection: true,
    route: (admission) => handleAdmittedTts(request, body, { modelStr, responseFormat, language }, admission),
  });
}

async function handleAdmittedTts(request, body, { modelStr, responseFormat, language }, { settings, apiKey, auth: apiKeyAuth }) {
  // Capture once for combo retries and delayed stream EOF, preserving null.
  const { billingEpoch } = apiKeyAuth;
  const authenticatedKeyRecord = apiKey ? await getApiKeyByKey(apiKey) : null;
  if (authenticatedKeyRecord && isAutoComboId(modelStr) && authenticatedKeyRecord.policy?.allowAutoCombos === false) {
    return errorResponse(HTTP_STATUS.FORBIDDEN, "Access denied: auto combos are not allowed for this API key");
  }

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

  if (!body.input) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");

  if (wantsDefaultRoute(modelStr)) {
    const route = await resolveMediaRoute("tts", { settings, apiKeyId: apiKeyAuth.apiKeyId });
    if (route.error) return route.error;
    return handleComboChat({
      apiKeyId: apiKeyAuth.apiKeyId,
      body,
      models: route.models,
      handleSingleModel: (b, m, _signal, attemptOptions) => handleSingleModelTts(b, m, responseFormat, language, request, apiKey, apiKeyAuth.apiKeyId, billingEpoch, null, attemptOptions?.reportComboPolicyRejections),
      log,
      ...defaultRouteComboOptions("tts")
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
    log.info("TTS", `Combo "${comboName}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      apiKeyId: apiKeyAuth.apiKeyId,
      body,
      models: comboModels,
      handleSingleModel: (b, m, _signal, attemptOptions) => handleSingleModelTts(b, m, responseFormat, language, request, apiKey, apiKeyAuth.apiKeyId, billingEpoch, comboRouting, attemptOptions?.reportComboPolicyRejections),
      log,
      comboName,
      comboStrategy,
      comboStickyLimit,
      comboMembers: combo?.members || []
    });
  }
  return handleSingleModelTts(body, modelStr, responseFormat, language, request, apiKey, apiKeyAuth.apiKeyId, billingEpoch);
}

async function handleSingleModelTts(body, modelStr, responseFormat, language, request, apiKey, apiKeyId, billingEpoch, comboRouting = null, reportComboPolicyRejections = false) {
  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  const { provider, model } = modelInfo;
  const resolvedPolicyError = await enforceApiKeyModelPolicy(request, `${provider}/${model}`, apiKey);
  if (resolvedPolicyError) return reportComboPolicyRejections && resolvedPolicyError.status === HTTP_STATUS.FORBIDDEN ? comboPolicyRejection() : resolvedPolicyError;
  const kindError = await modelKindError(provider, model, await getSettings(), "tts");
  if (kindError) return kindError;
  // The format the client named, if any. `responseFormat` falls back to mp3 for
  // providers that encode to order; an adapter that cannot (RenderHour) refuses
  // a named format it cannot honor before anything is sent.
  const requestedResponseFormat = new URL(request.url).searchParams.get("response_format") || body.response_format || null;
  const recordAcceptedTts = async (result, credentials) => {
    await recordAcceptedJobUsage(apiKey, {
      ...result.acceptedJob,
      billingEpoch,
      usageEventId: `${getRequestId(request)}:tts`, provider, model,
      connectionId: credentials.connectionId || null,
      endpoint: "/v1/audio/speech", modality: "tts",
      apiKeyId,
    });
    return result.response;
  };
  const preferredConnectionId = request.headers.get("x-connection-id") || null;
  const pinOptions = preferredConnectionId ? { preferredConnectionId, strictConnectionId: preferredConnectionId } : {};
  /** Reuse request identity across retries; never parse or buffer audio for usage.
   * Streaming EOF waits for completed accounting and a durable ledger write.
   * Failed billing errors the response stream instead of reporting clean EOF.
   */
  const recordSuccess = (result, credentials) => {
    const record = (accounting) => recordApiKeyUsageForResponse(apiKey, result.response, {
      ...accounting,
      billingEpoch,
      usageEventId: `${getRequestId(request)}:tts`, provider, model,
      connectionId: credentials.connectionId || null,
      endpoint: "/v1/audio/speech", modality: "tts",
      // The stable id of the admitted key travels with the usage.
      apiKeyId,
    });
    if (!result.accountingCompletion && (result.audioBuffered || !result.response.body)) return record(result.accounting);

    // Observe rejection immediately, but persist only from the awaited EOF path.
    const completion = result.accountingCompletion?.then(
      (outcome) => ({ outcome }),
      (error) => ({ error }),
    );
    const reader = result.response.body.getReader();
    let cancelled = false;
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (cancelled) return;
          if (!done) {
            controller.enqueue(value);
            return;
          }
          const { outcome, error } = completion
            ? await completion
            : { outcome: { status: "completed", accounting: result.accounting } };
          if (cancelled) return;
          if (error) throw error;
          if (outcome.status === "completed") await record(outcome.accounting);
          if (cancelled) return;
          controller.close();
        } catch (error) {
          if (!cancelled) controller.error(error);
        }
      },
      cancel(reason) {
        cancelled = true;
        return reader.cancel(reason);
      },
    }, { highWaterMark: 0 });
    return new Response(stream, {
      status: result.response.status,
      statusText: result.response.statusText,
      headers: result.response.headers,
    });
  };
  log.info("ROUTING", `Provider: ${provider}, Voice: ${model}`);

  // Local/no-auth execution remains unrestricted only for keys with zero
  // provider-account relations.
  if (!CREDENTIALED_PROVIDERS.has(provider)) {
    const selectionOptions = {
      ...pinOptions,
      apiKeyId,
      allowedConnectionIds: comboRouting?.allowedConnectionIds || null,
      restrictionApplied: comboRouting?.restrictionApplied === true
    };
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
    const coreOptions = { ...body, provider, requestProvider: body.provider, routingPolicy: (await getSettings()).openrouterRouting, model, input: body.input, credentials, responseFormat, language, signal: request.signal };
    return handleTtsCore(coreOptions).then((result) => result.success
      ? recordSuccess(result, credentials)
      : errorResponse(result.status || HTTP_STATUS.BAD_GATEWAY, result.error || "TTS failed"));
  }

  // Credentialed providers — fallback loop (same pattern as embeddings)
  return runMediaAccounts({
    provider,
    model,
    selectionOptions: {
      ...pinOptions,
      apiKeyId,
      allowedConnectionIds: comboRouting?.allowedConnectionIds || null,
      restrictionApplied: comboRouting?.restrictionApplied === true
    },
    buildExhaustedResponse(credentials, { lastError, lastStatus, attempted }) {
      if (credentials?.providerDisabled) {
        log.warn("TTS", `[${provider}/${model}] free no-auth provider disabled by settings`);
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Provider '${provider}' is disabled. Enable it in Settings > Providers.`);
      }
      if (credentials?.allRateLimited) {
        const msg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        return unavailableResponse(status, `[${provider}/${model}] ${msg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (attempted === 0) return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    },
    async runAttempt(selected) {
    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${selected.connectionName}\x1b[0m`);

    // A RenderHour plan sign-in is refreshed before its job is submitted.
    const credentials = REFRESHED_BEFORE_DISPATCH.has(provider) ? await checkAndRefreshToken(provider, selected) : selected;
    const dispatch = credentialDispatchSnapshot(credentials);
    const result = await handleTtsCore({ ...body, provider, requestProvider: body.provider, routingPolicy: (await getSettings()).openrouterRouting, model, input: body.input, credentials, responseFormat, ...(NAMED_FORMAT_PROVIDERS.has(provider) ? { requestedResponseFormat } : null), language, signal: request.signal });

    if (result.success) return { response: await recordSuccess(result, credentials) };
    // A job the provider may bill is recorded once, on this account, and never resubmitted elsewhere.
    if (request.signal?.aborted && result.acceptedJob) return { response: await recordAcceptedTts(result, credentials) };
    return { result, dispatch, failureContext: { usedCredential: credentials.accessToken || credentials.apiKey || null } };
    },
    onAccountFailure: (result, credentials) => (result.acceptedJob ? recordAcceptedTts(result, credentials) : null),
    buildFailureResponse: (result) => result.response || errorResponse(result.status, result.error),
  });
}
export const handleTts = withRequestCorrelation(handleTtsHandler);
