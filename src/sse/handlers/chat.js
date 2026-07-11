import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  extractApiKey,
  evaluateApiKeyAuth,
} from "../services/auth.js";
import { cacheClaudeHeaders } from "open-sse/utils/claudeHeaderCache.js";
import { getSettings, getApiKeyByKey, getApiKeyUsageLimitStatus } from "@/lib/localDb";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { getModelInfo, getComboModels } from "../services/model.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL } from "@/lib/headroom/detect";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { handleComboChat, handleFusionChat } from "open-sse/services/combo.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { handlePonytailCommands, DEFAULT_PONYTAIL_HELP, resolvePonytailStream } from "open-sse/utils/tokenSaverBridge.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import { detectFormat } from "open-sse/services/provider.js";
import { isAntigravityCapacityError } from "open-sse/services/accountFallback.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { enforceApiKeyModelPolicy } from "../services/apiKeyPolicy.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { validateChatRequestBody } from "open-sse/translator/validate.js";

const ANTIGRAVITY_CAPACITY_SWEEP_RETRIES = 2;

/**
 * #6457 / OmniRoute#6525: resolved registry model kind === "image" means the
 * model is image-only and belongs on /v1/images/generations, not the chat
 * endpoint. Forwarding it to a chat upstream yields a confusing raw provider
 * 400 (e.g. HuggingFace: "not a chat model"). Per-model kind is used (not the
 * provider-level serviceKinds) because mixed providers like Cloudflare serve
 * both chat and image models.
 */
export function isImageOnlyModel(provider, model) {
  const entry = REGISTRY.find(
    (e) => e.id === provider || e.alias === provider || e.aliases?.includes(provider)
  );
  const m = entry?.models?.find((x) => x.id === model);
  return (m?.kind ?? m?.type) === "image";
}

/**
 * Strip reasoning_content from assistant messages in conversation history.
 * Some providers (e.g. Mistral) reject requests containing reasoning_content
 * in assistant messages with "extra_forbidden" validation errors.
 * This field is only meaningful in streaming responses, not in request bodies.
 */
function stripReasoningFromMessages(body) {
  if (!body.messages || !Array.isArray(body.messages)) return body;
  let modified = false;
  for (const msg of body.messages) {
    if (msg && msg.role === "assistant" && msg.reasoning_content !== undefined) {
      delete msg.reasoning_content;
      modified = true;
    }
  }
  return modified ? { ...body, messages: [...body.messages] } : body;
}

/**
 * Fix message ordering for providers that require specific role sequences.
 * Mistral requires the last message to be user/tool (or assistant with prefix=true).
 * If the last message is an assistant without prefix, add prefix: true so the
 * provider can continue generation from that point.
 */
function fixMessageOrdering(messages) {
  if (!messages || !Array.isArray(messages) || messages.length === 0) return;
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant" && !last.prefix) {
    last.prefix = true;
  }
}


/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null) {
  let body;
  try {
    body = await request.json();
  } catch {
    log.warn("CHAT", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  // Inbound schema guard (OmniRoute O-A): reject malformed `messages` / `model`
  // / scalar params with a clear 400 BEFORE auth + model resolution, so a bad
  // body never surfaces as a misleading `model_not_found` 404 or an unsanitized
  // 500. See open-sse/translator/validate.js (ports #6515/#6433/#6437).
  const earlyRejection = validateChatRequestBody(body);
  if (earlyRejection) {
    log.warn("CHAT", "Rejecting schema-invalid request body");
    return earlyRejection;
  }

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  cacheClaudeHeaders(clientRawRequest.headers);

  const modelStr = body.model;

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

  // Log API key (masked)
  const authHeader = request.headers.get("Authorization");
  const apiKey = extractApiKey(request);
  if (authHeader && apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Stored credentials are always validated; local mode only permits unknown
  // placeholders when API-key enforcement is disabled.
  const settings = await getSettings();
  const apiKeyAuth = await evaluateApiKeyAuth(apiKey, { required: settings.requireApiKey === true });
  if (!apiKeyAuth.ok) {
    if (apiKeyAuth.reason === "missing") {
      log.warn("AUTH", "Missing API key (requireApiKey=true)");
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");
    }
    log.warn("AUTH", "Invalid API key");
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  // Per-key combo access control. Retain the authenticated record so local
  // commands can expose only this key's own lifetime totals.
  let authenticatedKeyRecord = null;
  if (apiKey && modelStr) {
    authenticatedKeyRecord = await getApiKeyByKey(apiKey);
    if (authenticatedKeyRecord && Array.isArray(authenticatedKeyRecord.allowedCombos) && authenticatedKeyRecord.allowedCombos.length > 0) {
      const comboCheck = await getComboModels(modelStr);
      if (comboCheck && !authenticatedKeyRecord.allowedCombos.includes(modelStr)) {
        log.warn("AUTH", `API key "${authenticatedKeyRecord.name}" not allowed to access combo "${modelStr}"`);
        return errorResponse(HTTP_STATUS.FORBIDDEN, `Access denied: combo "${modelStr}" is not allowed for this API key`);
      }
    }
  }

  if (apiKey) {
    const limitStatus = await getApiKeyUsageLimitStatus(apiKey);
    if (limitStatus.exceeded) {
      const used = Math.round(limitStatus.usedTokens);
      const limit = Math.round(limitStatus.limitTokens);
      log.warn("AUTH", `API key daily token limit exceeded (${used}/${limit})`);
      return errorResponse(HTTP_STATUS.RATE_LIMITED, `API key daily token limit exceeded (${used}/${limit} tokens)`);
    }
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Ponytail slash commands are local-only: respond before any account/credential lookup.
  const sourceFormat = detectFormatByEndpoint(
    clientRawRequest?.endpoint || new URL(request.url).pathname,
    body,
  ) || detectFormat(body);
  const acceptHeader = clientRawRequest?.headers?.accept || "";
  const ponytailResponse = await handlePonytailCommands(body, modelStr, {
    fetchStats: authenticatedKeyRecord
      ? async () => {
          const { getApiKeyUsageTotals } = await import("@/lib/localDb");
          return {
            ...(await getApiKeyUsageTotals(authenticatedKeyRecord.id)),
            scope: "this API key",
          };
        }
      : null,
    helpText: DEFAULT_PONYTAIL_HELP,
    sourceFormatOverride: sourceFormat,
    streamOverride: resolvePonytailStream(body, sourceFormat, acceptHeader),
  });
  if (ponytailResponse?.success && ponytailResponse.response) {
    return ponytailResponse.response;
  }

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  // Check if model is a combo (has multiple models with fallback)
  const comboModels = await getComboModels(modelStr);
  if (comboModels) {
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";

    // Combo names are intentionally excluded from the model allowlist; the allowlist
    // is enforced against each concrete underlying model during expansion. Combo-level
    // combo access control above remains the gate for combo names.
    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
      return handleFusionChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: comboModels,
      handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit
    });
  }

  // Single model request
  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey);
}

/**
 * Handle single model chat request
 */
async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null) {
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      const chatSettings = await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey);
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // Reject image-only models routed to /v1/chat/completions (#6457 / #6525).
  // getModelInfo already resolved the registry {provider, model}; a kind:"image"
  // entry belongs on /v1/images/generations. Guard fires before credentials /
  // dispatch so the upstream is never called.
  if (isImageOnlyModel(provider, model)) {
    log.warn("CHAT", `Rejecting image-generation model on chat endpoint: ${provider}/${model}`);
    return errorResponse(
      HTTP_STATUS.BAD_REQUEST,
      `Model '${provider}/${model}' is an image-generation model and cannot be used on /v1/chat/completions. Use POST /v1/images/generations instead.`
    );
  }

  // Enforce per-API-key model policy against the resolved underlying model when
  // the request started as a combo; the top-level combo name is not a model id.
  const policyError2 = await enforceApiKeyModelPolicy(request, `${provider}/${model}`);
  if (policyError2) return policyError2;

  // Strip reasoning_content for providers that reject it (Mistral, etc.)
  // Preserve for providers that require it (DeepSeek thinking mode)
  if (!provider.startsWith("deepseek")) {
    body = stripReasoningFromMessages(body);
  }
  // Fix message ordering for all providers (prefix: true for last assistant)
  fixMessageOrdering(body.messages);

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  let lastError = null;
  let lastStatus = null;
  let antigravityCapacitySweeps = 0;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      if (
        (provider === "antigravity" || provider === "agy") &&
        isAntigravityCapacityError(lastStatus, lastError) &&
        antigravityCapacitySweeps < ANTIGRAVITY_CAPACITY_SWEEP_RETRIES
      ) {
        antigravityCapacitySweeps += 1;
        log.warn("CHAT", `[${provider}/${model}] all accounts reported capacity; restarting account sweep ${antigravityCapacitySweeps}/${ANTIGRAVITY_CAPACITY_SWEEP_RETRIES}`);
        excludeConnectionIds.clear();
        continue;
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    // Account selection shown in the unified "▶" line (acc:...)
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "agy" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const pid = await getProjectIdForConnection(
        credentials.connectionId,
        refreshedCredentials.accessToken,
        refreshedCredentials.providerSpecificData,
      );
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Use shared chatCore
    const chatSettings = await getSettings();
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const result = await handleChatCore({
      body: { ...structuredClone(body), model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: !!chatSettings.rtkEnabled,
      headroomEnabled: !!chatSettings.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      cavemanEnabled: !!chatSettings.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: !!chatSettings.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      pxpipeEnabled: !!chatSettings.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      pxpipeTransform: chatSettings.pxpipeEnabled ? await getPxpipeTransform() : null,
      onPxpipeEvent: appendPxpipeEvent,
      providerThinking,
      providerConcurrencyLimit: chatSettings.providerConcurrencyLimits,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      },
      // Empty-stream retries exhausted mid-stream (headers already sent, so no
      // pre-stream fallback is possible): bench the account so the client's
      // automatic retry of the in-stream error lands on the next one. Quota
      // exhaustion passes a precise resetsAtMs instead of the generic cooldown.
      onUpstreamEmptyExhausted: async (reason, resetsAtMs) => {
        await markAccountUnavailable(credentials.connectionId, HTTP_STATUS.BAD_GATEWAY, reason, provider, model, resetsAtMs);
      }
    });

    if (result.success) return result.response;

    // Mark account unavailable (auto-calculates cooldown with exponential backoff, or precise resetsAtMs)
    const { shouldFallback } = await markAccountUnavailable(credentials.connectionId, result.status, result.error, provider, model, result.resetsAtMs);

    if (shouldFallback) {
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}
